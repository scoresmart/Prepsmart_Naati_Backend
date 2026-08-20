import { Subscription } from "../models/subscription.model.js";
import { User } from "../models/user.model.js";
import { Language } from "../models/language.model.js";
function computeIsSubscription(sub) {
  const now = new Date();
  const end = sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
  return ["active", "trialing"].includes(sub?.status) && end && end > now;
}

const userAttrs = [
  "id",
  "name",
  "email",
  "phone",
  "preferredLanguage",
  "isVerified",
  "createdAt",
];

function mapSubWithUser(row) {
  const sub = row?.Subscription || row;
  const user = row?.User || row?.user || null;

  return {
    user: user
      ? {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          preferredLanguage: user.preferredLanguage,
          isVerified: user.isVerified,
          createdAt: user.createdAt,
          stripeCustomerId: user.stripeCustomerId || null,
        }
      : null,
    subscription: sub
      ? {
          id: sub.id,
          userId: sub.userId,
          isSubscription: computeIsSubscription(sub),
          status: sub.status,
          currentPeriodEnd: sub.currentPeriodEnd,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          stripeSubscriptionId: sub.stripeSubscriptionId,
          stripePriceId: sub.stripePriceId,
          stripeCustomerId: sub.stripeCustomerId,
          createdAt: sub.createdAt,
          updatedAt: sub.updatedAt,
          language: sub.language || null,
        }
      : null,
  };
}

export async function getSubscriptionStatus(req, res) {
  try {
    const userId = Number(req.params.userId || req.query.userId);
    if (!userId) return res.status(400).json({ error: "userId required" });

    const sub = await Subscription.findOne({
      where: { userId },
      include: [{ model: User, attributes: userAttrs }],
    });

    if (!sub) {
      const user = await User.findByPk(userId, { attributes: userAttrs });
      return res.json({
        user: user
          ? {
              id: user.id,
              name: user.name,
              email: user.email,
              phone: user.phone,
              preferredLanguage: user.preferredLanguage,
              isVerified: user.isVerified,
              createdAt: user.createdAt,
              stripeCustomerId: user.stripeCustomerId || null,
            }
          : null,
        subscription: null,
      });
    }

    return res.json(mapSubWithUser(sub));
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
}

export async function getAllSubscriptions(req, res) {
  try {
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const offset = Number(req.query.offset || 0);
    const status = req.query.status ? String(req.query.status) : null;

    const where = {};
    if (status) where.status = status;

    const subs = await Subscription.findAll({
      where,
      include: [
        { model: User, attributes: userAttrs },
        { model: Language, as: "language" },
      ],
      order: [["id", "DESC"]],
      limit,
      offset,
    });

    return res.json(subs.map(mapSubWithUser));
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
}

export async function getSubOfAUser(req, res) {
  try {
    const userId = Number(req.params.userId || req.query.userId || req.body.userId);
    if (!userId) return res.status(400).json({ error: "userId required" });

    const subs = await Subscription.findAll({
      where: { userId },
      include: [
        { model: User, attributes: userAttrs },
        { model: Language, as: "language" },
      ],
      order: [["id", "DESC"]],
    });

    return res.json(subs.map(mapSubWithUser));
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
}

export async function getOneSub(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id required" });

    const sub = await Subscription.findByPk(id, {
      include: [
        { model: User, attributes: userAttrs },
        { model: Language, as: "language" },
      ],
    });

    if (!sub) return res.status(404).json({ error: "Subscription not found" });

    return res.json(mapSubWithUser(sub));
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
}


export async function updateSub(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id required" });

    const sub = await Subscription.findByPk(id);
    if (!sub) return res.status(404).json({ error: "Subscription not found" });

    const allowed = [
      "status",
      "currentPeriodEnd",
      "cancelAtPeriodEnd",
      "stripePriceId",
      "stripeCustomerId",
      "stripeSubscriptionId",
      "userId",
    ];

    const updateData = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updateData[key] = req.body[key];
    }

    await sub.update(updateData);

    const updated = await Subscription.findByPk(id, {
      include: [{ model: User, attributes: userAttrs }],
    });

    return res.json(mapSubWithUser(updated));
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
}

export async function deleteSub(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id required" });

    const sub = await Subscription.findByPk(id);
    if (!sub) return res.status(404).json({ error: "Subscription not found" });

    await sub.destroy();
    return res.json({ deleted: true, id });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
}
