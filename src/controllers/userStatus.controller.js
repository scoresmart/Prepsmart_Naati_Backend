import { Op } from "sequelize";
import { models } from "../models/index.js";
import { User } from "../models/user.model.js";
import { Subscription } from "../models/subscription.model.js";
import MockTestSession from "../models/mockTestSession.model.js";
import ExamAttempt from "../models/examAttempt.model.js";

const toInt = (v) => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const daysLeft = (end) => {
  if (!end) return null;
  const now = new Date();
  const diff = new Date(end).getTime() - now.getTime();
  if (!Number.isFinite(diff)) return null;
  const d = Math.ceil(diff / 86400000);
  return d < 0 ? null : d;
};

const getActiveSubscriptions = async (userId) => {
  const now = new Date();

  const subs = await Subscription.findAll({
    where: {
      userId,
      status: { [Op.in]: ["active", "trialing", "past_due"] },
      [Op.or]: [
        { currentPeriodEnd: { [Op.is]: null } },
        { currentPeriodEnd: { [Op.gte]: now } },
      ],
    },
    attributes: [
      "id",
      "languageId",
      "status",
      "currentPeriodEnd",
      "cancelAtPeriodEnd",
      "stripeSubscriptionId",
      "stripePriceId",
    ],
    order: [["currentPeriodEnd", "DESC"]],
  });

  return subs.map((s) => ({
    id: s.id,
    languageId: s.languageId ?? null,
    status: s.status,
    currentPeriodEnd: s.currentPeriodEnd ?? null,
    daysLeft: daysLeft(s.currentPeriodEnd),
    cancelAtPeriodEnd: !!s.cancelAtPeriodEnd,
    stripeSubscriptionId: s.stripeSubscriptionId,
    stripePriceId: s.stripePriceId ?? null,
  }));
};

const findModel = (names) => {
  for (const n of names) {
    if (models?.[n]) return models[n];
  }
  return null;
};

export const getUserStatus = async (req, res, next) => {
  try {
    const userId = toInt(
      req.query.userId ?? req.params.userId ?? req.body?.userId
    );
    if (!userId)
      return res
        .status(400)
        .json({ success: false, message: "userId is required" });

    const user = await User.findByPk(userId, {
      attributes: [
        "id",
        "name",
        "email",
        "role",
        "preferredLanguage",
        "naatiCclExamDate",
        "createdAt",
      ],
    });
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    const Language = findModel(["Language"]);
    const MockTest = findModel(["MockTest"]);
    const Dialogue = findModel(["Dialogue"]);

    if (!Language || !MockTest || !Dialogue) {
      return res.status(500).json({
        success: false,
        message: "Required models not found (Language/MockTest/Dialogue)",
      });
    }

    const languages = await Language.findAll({ order: [["id", "ASC"]] });
    const activeSubscriptions = await getActiveSubscriptions(userId);

    const subByLanguageId = new Map();
    for (const s of activeSubscriptions) {
      const lid = Number(s.languageId);
      if (!Number.isFinite(lid)) continue;
      if (!subByLanguageId.has(lid)) subByLanguageId.set(lid, s);
    }

    const subscribedLanguageIds = Array.from(subByLanguageId.keys());

    const limits = {
      mockTest: 1,
      dialogue: 1,
      rapidReview: 5,
    };

    const mockTests = await MockTest.findAll({
      attributes: ["id", "languageId"],
      raw: true,
    });

    const mockTestIdToLang = new Map();
    for (const mt of mockTests) {
      const mid = Number(mt.id);
      const lid = Number(mt.languageId);
      if (Number.isFinite(mid) && Number.isFinite(lid))
        mockTestIdToLang.set(String(mid), lid);
    }

    const dialogues = await Dialogue.findAll({
      attributes: ["id", "languageId"],
      raw: true,
    });

    const dialogueIdToLang = new Map();
    for (const d of dialogues) {
      const did = Number(d.id);
      const lid = Number(d.languageId);
      if (Number.isFinite(did) && Number.isFinite(lid))
        dialogueIdToLang.set(String(did), lid);
    }

    const completedSessions = await MockTestSession.findAll({
      where: { userId, status: "completed" },
      attributes: ["mockTestId"],
      raw: true,
    });

    const mockUsedByLang = new Map();
    for (const s of completedSessions) {
      const lid = mockTestIdToLang.get(String(s.mockTestId));
      if (!Number.isFinite(lid)) continue;
      mockUsedByLang.set(lid, (mockUsedByLang.get(lid) || 0) + 1);
    }

    const examAttempts = await ExamAttempt.findAll({
      where: { userId },
      attributes: ["dialogueId", "examType"],
      raw: true,
    });

    const rapidUsedByLang = new Map();
    const completeUsedByLang = new Map();

    for (const a of examAttempts) {
      const lid = dialogueIdToLang.get(String(a.dialogueId));
      if (!Number.isFinite(lid)) continue;

      if (a.examType === "rapid_review") {
        rapidUsedByLang.set(lid, (rapidUsedByLang.get(lid) || 0) + 1);
      } else if (a.examType === "complete_dialogue") {
        completeUsedByLang.set(lid, (completeUsedByLang.get(lid) || 0) + 1);
      }
    }

    const languagesWithAccess = languages.map((l) => {
      const lid = Number(l.id);
      const subscribed =
        user.role === "admin" ? true : subByLanguageId.has(lid);

      const base = {
        ...l.toJSON(),
        isSubscribed: subscribed,
      };

      if (subscribed) {
        base.subscription = subByLanguageId.get(lid) ?? null;
        return base;
      }

      const used = {
        mockTest: mockUsedByLang.get(lid) || 0,
        dialogue: completeUsedByLang.get(lid) || 0,
        rapidReview: rapidUsedByLang.get(lid) || 0,
      };

      const remaining = {
        mockTest: Math.max(0, limits.mockTest - used.mockTest),
        dialogue: Math.max(0, limits.dialogue - used.dialogue),
        rapidReview: Math.max(0, limits.rapidReview - used.rapidReview),
      };

      base.trial = {
        limits,
        used,
        remaining,
        canUse: {
          mockTest: remaining.mockTest > 0,
          dialogue: remaining.dialogue > 0,
          rapidReview: remaining.rapidReview > 0,
        },
      };

      return base;
    });

    return res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          name: user.name,
          role: user.role,
          preferredLanguage: user.preferredLanguage,
          naatiCclExamDate: user.naatiCclExamDate,
          createdAt: user.createdAt,
        },
        activeSubscriptionsCount: activeSubscriptions.length,
        subscribedLanguageIds,
        subscriptions: activeSubscriptions,
        languages: languagesWithAccess,
      },
    });
  } catch (e) {
    next(e);
  }
};
