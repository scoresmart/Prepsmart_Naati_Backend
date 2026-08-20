// models/index.js (or wherever you keep associations)
import { User } from "./user.model.js";
import { Language } from "./language.model.js";
import { Domain } from "./domain.model.js";
import { Dialogue } from "./dialogue.model.js";
import { Segment } from "./segment.model.js";

import ExamAttempt from "./examAttempt.model.js";
import SegmentAttempt from "./segmentAttempt.model.js";
import ExamImage from "./examImage.model.js";

import { Subscription } from "./subscription.model.js";
import { Transaction } from "./transaction.model.js";

import MockTest from "./mocketTest.model.js";
import MockTestResult from "./mockTestResult.js";
import MockTestAttempts from "./mockTestAttempt.js";
import MockTestSession from "./mockTestSession.model.js";
import MockTestFinalResult from "./mockTestFinalResult.model.js";
import RapidReview from "./rapidReview.js";
import RapidReviewAttempt from "./rapidReviewAttempt.js";
/**
 * ------------------------------------------------------------
 * Core content hierarchy
 * Language -> Domain -> Dialogue -> Segment
 * ------------------------------------------------------------
 */
Language.hasMany(Domain, {
  foreignKey: "languageId",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
Domain.belongsTo(Language, { foreignKey: "languageId" });

Language.hasMany(Dialogue, {
  foreignKey: "languageId",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
Dialogue.belongsTo(Language, { foreignKey: "languageId" });

Domain.hasMany(Dialogue, {
  foreignKey: "domainId",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
Dialogue.belongsTo(Domain, { foreignKey: "domainId" });

Dialogue.hasMany(Segment, {
  foreignKey: "dialogueId",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
Segment.belongsTo(Dialogue, { foreignKey: "dialogueId" });

/**
 * ------------------------------------------------------------
 * Exam Attempts (rapid_review / complete_dialogue)
 * User -> ExamAttempt -> SegmentAttempt
 * ExamAttempt -> ExamImage
 * ------------------------------------------------------------
 */
User.hasMany(ExamAttempt, { foreignKey: "userId", onDelete: "CASCADE" });
ExamAttempt.belongsTo(User, { foreignKey: "userId" });

Dialogue.hasMany(ExamAttempt, {
  foreignKey: "dialogueId",
  onDelete: "CASCADE",
});
ExamAttempt.belongsTo(Dialogue, { foreignKey: "dialogueId" });

ExamAttempt.hasMany(SegmentAttempt, {
  foreignKey: "examAttemptId",
  onDelete: "CASCADE",
});
SegmentAttempt.belongsTo(ExamAttempt, { foreignKey: "examAttemptId" });

Segment.hasMany(SegmentAttempt, {
  foreignKey: "segmentId",
  onDelete: "CASCADE",
});
SegmentAttempt.belongsTo(Segment, { foreignKey: "segmentId" });

User.hasMany(SegmentAttempt, { foreignKey: "userId", onDelete: "CASCADE" });
SegmentAttempt.belongsTo(User, { foreignKey: "userId" });

ExamAttempt.hasMany(ExamImage, {
  foreignKey: "examAttemptId",
  onDelete: "CASCADE",
});
ExamImage.belongsTo(ExamAttempt, { foreignKey: "examAttemptId" });

User.hasMany(ExamImage, { foreignKey: "userId", onDelete: "CASCADE" });
ExamImage.belongsTo(User, { foreignKey: "userId" });

Segment.hasMany(ExamImage, { foreignKey: "segmentId", onDelete: "SET NULL" });
ExamImage.belongsTo(Segment, { foreignKey: "segmentId" });

/**
 * ------------------------------------------------------------
 * Subscription & Transactions
 * User -> Subscription
 * User -> Transaction
 * Subscription -> Transaction (optional link via stripeSubscriptionId)
 * ------------------------------------------------------------
 */
User.hasMany(Subscription, { foreignKey: "userId", onDelete: "CASCADE" });
Subscription.belongsTo(User, { foreignKey: "userId" });

User.hasMany(Transaction, { foreignKey: "userId", onDelete: "CASCADE" });
Transaction.belongsTo(User, { foreignKey: "userId" });
MockTest.belongsTo(Language, { foreignKey: "languageId", as: "language" });
Subscription.belongsTo(Language, { foreignKey: "languageId", as: "language" });

// optional (nice)
Subscription.hasMany(Transaction, {
  foreignKey: "stripeSubscriptionId",
  sourceKey: "stripeSubscriptionId",
});

/**
 * ------------------------------------------------------------
 * Mock Tests
 * Dialogue -> MockTest
 * User -> MockTestAttempts
 * Segment -> MockTestAttempts
 * MockTestResult -> (MockTest, User, Segment)
 * ------------------------------------------------------------
 */

Dialogue.hasMany(Segment, { foreignKey: "dialogueId", as: "segments" });
Segment.belongsTo(Dialogue, { foreignKey: "dialogueId", as: "dialogue" });

MockTest.belongsTo(Dialogue, { as: "dialogue1", foreignKey: "dialogueId" });
MockTest.belongsTo(Dialogue, { as: "dialogue2", foreignKey: "dialogueId2" });

Dialogue.hasMany(MockTest, {
  as: "mockTestsAsDialogue1",
  foreignKey: "dialogueId",
});
Dialogue.hasMany(MockTest, {
  as: "mockTestsAsDialogue2",
  foreignKey: "dialogueId2",
});

MockTest.hasMany(MockTestSession, { foreignKey: "mockTestId", as: "sessions" });
MockTestSession.belongsTo(MockTest, {
  foreignKey: "mockTestId",
  as: "mockTest",
});

User.hasMany(MockTestSession, { foreignKey: "userId", as: "mockTestSessions" });
MockTestSession.belongsTo(User, { foreignKey: "userId", as: "user" });

MockTestSession.hasMany(MockTestResult, {
  foreignKey: "mockTestSessionId",
  as: "segmentResults",
});
MockTestResult.belongsTo(MockTestSession, {
  foreignKey: { name: "mockTestSessionId", allowNull: false },
  as: "session",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});

Segment.hasMany(MockTestResult, {
  foreignKey: "segmentId",
  as: "mockTestResults",
});
MockTestResult.belongsTo(Segment, { foreignKey: "segmentId", as: "segment" });

MockTest.hasMany(MockTestResult, { foreignKey: "mockTestId", as: "results" });
MockTestResult.belongsTo(MockTest, {
  foreignKey: "mockTestId",
  as: "mockTest",
});

User.hasMany(MockTestResult, { foreignKey: "userId", as: "mockTestResults" });
MockTestResult.belongsTo(User, { foreignKey: "userId", as: "user" });

User.hasMany(MockTestAttempts, {
  foreignKey: "userId",
  as: "mockTestAttempts",
});
MockTestAttempts.belongsTo(User, { foreignKey: "userId", as: "user" });

MockTest.hasMany(MockTestAttempts, {
  foreignKey: "mockTestId",
  as: "attempts",
});
MockTestAttempts.belongsTo(MockTest, {
  foreignKey: "mockTestId",
  as: "mockTest",
});

Segment.hasMany(MockTestAttempts, { foreignKey: "segmentId", as: "attempts" });
MockTestAttempts.belongsTo(Segment, { foreignKey: "segmentId", as: "segment" });

Dialogue.hasMany(MockTestAttempts, {
  foreignKey: "dialogueId",
  as: "attempts",
});
MockTestAttempts.belongsTo(Dialogue, {
  foreignKey: "dialogueId",
  as: "dialogue",
});

MockTestSession.hasMany(MockTestAttempts, {
  foreignKey: "mockTestSessionId",
  as: "attempts",
});
MockTestAttempts.belongsTo(MockTestSession, {
  foreignKey: { name: "mockTestSessionId", allowNull: false },
  as: "session",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});

MockTestSession.hasOne(MockTestFinalResult, {
  foreignKey: "mockTestSessionId",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
MockTestFinalResult.belongsTo(MockTestSession, {
  foreignKey: "mockTestSessionId",
});

MockTest.hasMany(MockTestFinalResult, { foreignKey: "mockTestId" });
MockTestFinalResult.belongsTo(MockTest, { foreignKey: "mockTestId" });

User.hasMany(MockTestFinalResult, { foreignKey: "userId" });
MockTestFinalResult.belongsTo(User, { foreignKey: "userId" });
RapidReview.belongsTo(Language, {
  foreignKey: "languageId",
  as: "language",
});

RapidReview.belongsTo(Segment, {
  foreignKey: "segmentId",
  as: "segment",
});
SegmentAttempt.belongsTo(Segment, {
  foreignKey: "segmentId",
  as: "segment",
});
export const models = {
  User,
  Language,
  Domain,
  Dialogue,
  Segment,
  ExamAttempt,
  SegmentAttempt,
  ExamImage,
  Subscription,
  Transaction,
  MockTest,
  MockTestResult,
  MockTestAttempts, // (kept, since you imported it)
  MockTestSession,
  MockTestFinalResult,
  RapidReview,
  RapidReviewAttempt,
};
