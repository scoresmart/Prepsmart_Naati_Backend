import { Op } from "sequelize";
import { User } from "../models/user.model.js";
import MockTestSession from "../models/mockTestSession.model.js";
import MockTestAttempts from "../models/mockTestAttempt.js";
import MockTest from "../models/mocketTest.model.js";
import { Dialogue } from "../models/dialogue.model.js";
import { Segment } from "../models/segment.model.js";

const toInt = (v) => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const round2 = (n) => Number((Math.round(Number(n) * 100) / 100).toFixed(2));

const clamp = (num, min, max) => {
  const n = typeof num === "number" ? num : Number(num);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
};

const avg = (vals) => {
  const arr = (vals || [])
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n));
  if (!arr.length) return null;
  return round2(arr.reduce((a, b) => a + b, 0) / arr.length);
};

const toUTCDateOnly = (d) =>
  new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0)
  );

const daysBetweenDateOnly = (fromDate, toDate) => {
  const a = toUTCDateOnly(fromDate);
  const b = toUTCDateOnly(toDate);
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
};

const dateOnlyToUTCDate = (dateOnly) => {
  if (!dateOnly) return null;
  const s = String(dateOnly);
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

const dayKeyUTC = (d) => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
};

const distributeMarks = (totalMarks, count) => {
  if (!count || count <= 0) return [];
  const total = round2(totalMarks);
  const base = round2(Math.floor((total / count) * 100) / 100);
  const arr = Array(count).fill(base);
  const current = round2(base * count);
  let rem = round2(total - current);
  let pennies = Math.round(rem * 100);
  let i = 0;
  while (pennies > 0) {
    arr[i] = round2(arr[i] + 0.01);
    pennies -= 1;
    i += 1;
    if (i >= arr.length) i = 0;
  }
  return arr;
};

const computeDialogueDayEvents = async ({ userId, startUTC, endUTC }) => {
  const attempts = await MockTestAttempts.findAll({
    where: {
      userId,
      mockTestSessionId: { [Op.is]: null },
      createdAt: { [Op.gte]: startUTC, [Op.lt]: endUTC },
    },
    attributes: [
      "id",
      "dialogueId",
      "segmentId",
      "finalScore",
      "overallScore",
      "createdAt",
    ],
    order: [["createdAt", "DESC"]],
  });

  if (!attempts.length) return [];

  const dialogueIds = Array.from(
    new Set(attempts.map((a) => String(a.dialogueId)).filter(Boolean))
  ).map((x) => Number(x));

  const segments = await Segment.findAll({
    where: { dialogueId: { [Op.in]: dialogueIds } },
    attributes: ["id", "dialogueId", "segmentOrder"],
    order: [
      ["dialogueId", "ASC"],
      ["segmentOrder", "ASC"],
    ],
  });

  const segmentsByDialogue = new Map();
  for (const s of segments) {
    const key = String(s.dialogueId);
    if (!segmentsByDialogue.has(key)) segmentsByDialogue.set(key, []);
    segmentsByDialogue
      .get(key)
      .push({ id: Number(s.id), order: Number(s.segmentOrder) });
  }

  const latestByDayDialogueSegment = new Map();
  for (const a of attempts) {
    const createdAt = new Date(a.createdAt);
    const dk = dayKeyUTC(createdAt);
    const key = `${dk}|${a.dialogueId}|${a.segmentId}`;
    if (!latestByDayDialogueSegment.has(key))
      latestByDayDialogueSegment.set(key, a);
  }

  const byDayDialogue = new Map();
  for (const [k, a] of latestByDayDialogueSegment.entries()) {
    const [dk, dialogueIdStr] = k.split("|");
    const dialogueId = Number(dialogueIdStr);
    const dayDialogueKey = `${dk}|${dialogueId}`;
    if (!byDayDialogue.has(dayDialogueKey))
      byDayDialogue.set(dayDialogueKey, []);
    byDayDialogue.get(dayDialogueKey).push(a);
  }

  const perDialogueComplete = [];
  for (const [k, arr] of byDayDialogue.entries()) {
    const [dk, dialogueIdStr] = k.split("|");
    const dialogueId = Number(dialogueIdStr);
    const segList = segmentsByDialogue.get(String(dialogueId)) || [];
    if (!segList.length) continue;

    const needed = new Set(segList.map((s) => String(s.id)));
    const got = new Map(arr.map((a) => [String(a.segmentId), a]));
    if (got.size !== needed.size) continue;

    let dialogueScore = 0;
    const marks = distributeMarks(45, segList.length);

    let lastAt = null;
    for (let i = 0; i < segList.length; i++) {
      const segId = String(segList[i].id);
      const at = got.get(segId);
      if (!at) {
        lastAt = null;
        break;
      }
      const score45 = clamp(
        Number(at.finalScore ?? at.overallScore ?? 0),
        0,
        45
      );
      const obtained = round2((score45 / 45) * marks[i]);
      dialogueScore = round2(dialogueScore + obtained);
      const ca = new Date(at.createdAt);
      if (!lastAt || ca > lastAt) lastAt = ca;
    }

    if (!lastAt) continue;

    perDialogueComplete.push({
      date: dk,
      dialogueId,
      dialogueScoreOutOf45: dialogueScore,
      completedAt: lastAt,
    });
  }

  const byDay = new Map();
  for (const item of perDialogueComplete) {
    if (!byDay.has(item.date)) byDay.set(item.date, []);
    byDay.get(item.date).push(item);
  }

  const events = [];
  for (const [date, list] of byDay.entries()) {
    const unique = new Map();
    for (const x of list) unique.set(String(x.dialogueId), x);
    const arr = Array.from(unique.values());
    if (arr.length < 2) continue;

    arr.sort((a, b) => b.dialogueScoreOutOf45 - a.dialogueScoreOutOf45);
    const top2 = arr.slice(0, 2);
    const scoreOutOf90 = round2(
      top2[0].dialogueScoreOutOf45 + top2[1].dialogueScoreOutOf45
    );

    const completedAt = top2.reduce(
      (mx, x) => (mx && mx > x.completedAt ? mx : x.completedAt),
      null
    );

    events.push({
      type: "dialogue_practice",
      date,
      scoreOutOf90,
      completedAt,
      dialogues: top2.map((x) => ({
        dialogueId: x.dialogueId,
        scoreOutOf45: x.dialogueScoreOutOf45,
      })),
    });
  }

  events.sort(
    (a, b) =>
      new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
  );
  return events;
};

export const getUserDashboardKpis = async (req, res, next) => {
  try {
    const userId = toInt(req.params.userId ?? req.query.userId);
    if (!userId)
      return res
        .status(400)
        .json({ success: false, message: "userId is required" });

    const user = await User.findByPk(userId, {
      attributes: [
        "id",
        "name",
        "preferredLanguage",
        "naatiCclExamDate",
        "createdAt",
      ],
    });
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    const now = new Date();
    const startTodayUTC = toUTCDateOnly(now);
    const startTomorrowUTC = new Date(startTodayUTC.getTime() + 86400000);
    const startLast7DaysUTC = new Date(startTodayUTC.getTime() - 6 * 86400000);

    const totalTests = await MockTestSession.count({ where: { userId } });
    const completedTests = await MockTestSession.count({
      where: { userId, status: "completed" },
    });
    const pendingTests = await MockTestSession.count({
      where: { userId, status: { [Op.ne]: "completed" } },
    });

    const mockToday = await MockTestSession.findAll({
      where: {
        userId,
        status: "completed",
        completedAt: { [Op.gte]: startTodayUTC, [Op.lt]: startTomorrowUTC },
      },
      attributes: ["id", "mockTestId", "totalScore", "completedAt"],
      order: [["completedAt", "DESC"]],
    });

    const mockLast7 = await MockTestSession.findAll({
      where: {
        userId,
        status: "completed",
        completedAt: { [Op.gte]: startLast7DaysUTC, [Op.lt]: startTomorrowUTC },
      },
      attributes: ["id", "mockTestId", "totalScore", "completedAt"],
      order: [["completedAt", "DESC"]],
    });

    const dialogueTodayEvents = await computeDialogueDayEvents({
      userId,
      startUTC: startTodayUTC,
      endUTC: startTomorrowUTC,
    });

    const dialogueLast7Events = await computeDialogueDayEvents({
      userId,
      startUTC: startLast7DaysUTC,
      endUTC: startTomorrowUTC,
    });

    const todayScores = [
      ...mockToday.map((s) => Number(s.totalScore)),
      ...dialogueTodayEvents.map((e) => Number(e.scoreOutOf90)),
    ].filter((n) => Number.isFinite(n));

    const weekScores = [
      ...mockLast7.map((s) => Number(s.totalScore)),
      ...dialogueLast7Events.map((e) => Number(e.scoreOutOf90)),
    ].filter((n) => Number.isFinite(n));

    const avgToday = avg(todayScores);
    const avgLast7Days = avg(weekScores);

    const mockMax = await MockTestSession.max("totalScore", {
      where: { userId, status: "completed" },
    });

    const firstMock = await MockTestSession.min("createdAt", {
      where: { userId },
    });
    const firstDialogueAttempt = await MockTestAttempts.min("createdAt", {
      where: { userId, mockTestSessionId: { [Op.is]: null } },
    });

    const firstPracticeDate = [firstMock, firstDialogueAttempt]
      .filter(Boolean)
      .map((d) => new Date(d))
      .sort((a, b) => a.getTime() - b.getTime())[0];

    const practiceDays = firstPracticeDate
      ? Math.max(0, daysBetweenDateOnly(firstPracticeDate, now) + 1)
      : 0;

    const examDateUTC = dateOnlyToUTCDate(user.naatiCclExamDate);
    let daysLeftUntilExam = null;
    if (examDateUTC) {
      const diff = daysBetweenDateOnly(now, examDateUTC);
      daysLeftUntilExam = diff < 0 ? null : diff;
    }

    const daysSinceSignup = user.createdAt
      ? Math.max(0, daysBetweenDateOnly(new Date(user.createdAt), now))
      : null;

    const startAllDialogue = firstPracticeDate
      ? toUTCDateOnly(new Date(firstPracticeDate))
      : toUTCDateOnly(new Date(user.createdAt));
    const allDialogueEvents = await computeDialogueDayEvents({
      userId,
      startUTC: startAllDialogue,
      endUTC: startTomorrowUTC,
    });

    const dialogueMax = allDialogueEvents.length
      ? Math.max(...allDialogueEvents.map((e) => Number(e.scoreOutOf90)))
      : null;
    const highestScoreOutOf90 = Math.max(
      ...[mockMax, dialogueMax]
        .filter((x) => Number.isFinite(Number(x)))
        .map((x) => Number(x)),
      0
    );
    const highestScoreFinal =
      highestScoreOutOf90 > 0 ? round2(highestScoreOutOf90) : null;

    const dayBuckets = new Map();
    for (let i = 0; i < 7; i++) {
      const d = new Date(startTodayUTC.getTime() - i * 86400000);
      dayBuckets.set(dayKeyUTC(d), []);
    }

    for (const s of mockLast7) {
      const dk = dayKeyUTC(new Date(s.completedAt));
      if (dayBuckets.has(dk)) dayBuckets.get(dk).push(Number(s.totalScore));
    }
    for (const e of dialogueLast7Events) {
      if (dayBuckets.has(e.date))
        dayBuckets.get(e.date).push(Number(e.scoreOutOf90));
    }

    const weeklyDaily = Array.from(dayBuckets.entries())
      .map(([date, scores]) => ({ date, avgOutOf90: avg(scores) }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const recentMock = await MockTestSession.findAll({
      where: { userId, status: "completed" },
      attributes: ["id", "mockTestId", "totalScore", "completedAt"],
      order: [["completedAt", "DESC"]],
      limit: 10,
    });

    const recentDialogue = allDialogueEvents.slice(0, 10);

    const mockTestIds = Array.from(
      new Set(recentMock.map((x) => String(x.mockTestId)).filter(Boolean))
    ).map((x) => Number(x));
    const mockTests = mockTestIds.length
      ? await MockTest.findAll({
          where: { id: { [Op.in]: mockTestIds } },
          attributes: ["id", "title"],
        })
      : [];

    const mockTestTitleMap = new Map(
      mockTests.map((m) => [String(m.id), m.title])
    );

    const dialogueIdsUsed = Array.from(
      new Set(
        recentDialogue.flatMap((x) =>
          x.dialogues.map((d) => String(d.dialogueId))
        )
      )
    ).map((x) => Number(x));

    const dialogues = dialogueIdsUsed.length
      ? await Dialogue.findAll({
          where: { id: { [Op.in]: dialogueIdsUsed } },
          attributes: ["id", "title"],
        })
      : [];

    const dialogueTitleMap = new Map(
      dialogues.map((d) => [String(d.id), d.title])
    );

    const recentPractice = [
      ...recentMock.map((s) => ({
        type: "mock_test",
        at: s.completedAt,
        scoreOutOf90: Number(s.totalScore),
        mockTestSessionId: s.id,
        mockTestId: s.mockTestId,
        title: mockTestTitleMap.get(String(s.mockTestId)) || null,
      })),
      ...recentDialogue.map((e) => ({
        type: "dialogue_practice",
        at: e.completedAt,
        scoreOutOf90: Number(e.scoreOutOf90),
        date: e.date,
        dialogues: e.dialogues.map((d) => ({
          dialogueId: d.dialogueId,
          title: dialogueTitleMap.get(String(d.dialogueId)) || null,
          scoreOutOf45: d.scoreOutOf45,
        })),
      })),
    ]
      .filter((x) => x.at)
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 10);

    return res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          name: user.name,
          preferredLanguage: user.preferredLanguage,
          naatiCclExamDate: user.naatiCclExamDate,
        },
        kpis: {
          examCountdownDaysLeft: daysLeftUntilExam,
          practiceDays,
          daysSinceSignup,
          tests: {
            total: totalTests,
            pending: pendingTests,
            completed: completedTests,
          },
          scoresOutOf90: {
            todayAverage: avgToday,
            weeklyAverage: avgLast7Days,
            weeklyDaily,
            highest: highestScoreFinal,
          },
          recentPractice,
        },
      },
    });
  } catch (e) {
    next(e);
  }
};
