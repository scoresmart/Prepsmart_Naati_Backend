import Stripe from "stripe";
import dotenv from "dotenv";
import { Op } from "sequelize";
import { sequelize } from "../config/db.js";
import { User } from "../models/user.model.js";
import { Subscription } from "../models/subscription.model.js";
import { Transaction } from "../models/transaction.model.js";

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-09-30.acacia",
});

function toInt(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function priceIdFromType(type) {
  if (type === "one") return process.env.STRIPE_MONTHLY_PRICE_ID;
  if (type === "two") return process.env.STRIPE_TWO_MONTHLY_PRICE_ID;
  if (type === "three") return process.env.STRIPE_THREE_MONTHLY_PRICE_ID;
  return null;
}

function planTypeFromPriceId(priceId) {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_MONTHLY_PRICE_ID) return "one";
  if (priceId === process.env.STRIPE_TWO_MONTHLY_PRICE_ID) return "two";
  if (priceId === process.env.STRIPE_THREE_MONTHLY_PRICE_ID) return "three";
  return null;
}

async function findActiveSubForUser(userId, languageId) {
  const where = {
    userId,
    status: { [Op.in]: ["active", "trialing", "past_due"] },
    [Op.or]: [
      { currentPeriodEnd: { [Op.is]: null } },
      { currentPeriodEnd: { [Op.gte]: new Date() } },
    ],
  };
  if (languageId) where.languageId = languageId;
  return Subscription.findOne({ where, order: [["currentPeriodEnd", "DESC"]] });
}

function unixToDate(sec) {
  if (!sec) return null;
  return new Date(sec * 1000);
}

function getCurrentPeriodEndFromSub(sub) {
  return unixToDate(sub?.current_period_end);
}

function getPriceIdFromSub(sub) {
  return sub?.items?.data?.[0]?.price?.id || null;
}

function getPriceIdFromInvoice(inv) {
  return inv?.lines?.data?.[0]?.price?.id || null;
}

async function upsertSubscriptionRow(
  {
    userId,
    stripeCustomerId,
    stripeSubscriptionId,
    status,
    cancelAtPeriodEnd,
    currentPeriodEnd,
    stripePriceId,
    planType,
    languageId,
  },
  t
) {
  const existing = await Subscription.findOne({
    where: { stripeSubscriptionId },
    transaction: t,
  });

  const data = {
    userId,
    stripeCustomerId,
    stripeSubscriptionId,
    stripePriceId,
    status,
    cancelAtPeriodEnd: !!cancelAtPeriodEnd,
    currentPeriodEnd,
  };
  if (planType !== undefined) data.planType = planType;
  if (languageId !== undefined) data.languageId = languageId;

  if (existing) {
    await existing.update(data, { transaction: t });
    return existing;
  }

  return Subscription.create(data, { transaction: t });
}

async function resolveUserIdFromAny({
  session,
  stripeSub,
  stripeCustomerId,
  t,
}) {
  const fromSessionMeta = session?.metadata?.userId
    ? Number(session.metadata.userId)
    : null;
  if (fromSessionMeta) return fromSessionMeta;

  const fromClientRef = session?.client_reference_id
    ? Number(session.client_reference_id)
    : null;
  if (fromClientRef) return fromClientRef;

  const fromSubMeta = stripeSub?.metadata?.userId
    ? Number(stripeSub.metadata.userId)
    : null;
  if (fromSubMeta) return fromSubMeta;

  if (stripeCustomerId) {
    const user = await User.findOne({
      where: { stripeCustomerId },
      transaction: t,
    });
    if (user) return user.id;
  }

  return null;
}

async function upsertTransactionRow(
  {
    userId,
    stripeInvoiceId,
    stripeCustomerId,
    stripeSubscriptionId,
    stripePriceId,
    amount,
    currency,
    status,
    paidAt,
  },
  t
) {
  await Transaction.upsert(
    {
      userId,
      stripeInvoiceId,
      stripeCustomerId,
      stripeSubscriptionId,
      stripePriceId,
      amount,
      currency,
      status,
      paidAt,
    },
    { transaction: t }
  );
}

async function handleInvoiceCreateTransaction({ invoiceId, txStatus }) {
  const inv = await stripe.invoices.retrieve(invoiceId, {
    expand: ["lines.data.price"],
  });

  const stripeCustomerId = inv.customer;
  const stripeSubscriptionId = inv.subscription;
  if (!stripeSubscriptionId) return;

  const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId, {
    expand: ["items.data.price"],
  });

  await sequelize.transaction(async (t) => {
    const userId = await resolveUserIdFromAny({
      stripeSub: sub,
      stripeCustomerId,
      t,
    });
    if (!userId) return;

    await User.update(
      { stripeCustomerId },
      { where: { id: userId }, transaction: t }
    );

    const currentPeriodEnd = getCurrentPeriodEndFromSub(sub);
    const stripePriceIdFromSub = getPriceIdFromSub(sub);
    const stripePriceIdFromInv = getPriceIdFromInvoice(inv);

    const planType =
      sub.metadata?.planType ||
      planTypeFromPriceId(stripePriceIdFromSub || stripePriceIdFromInv) ||
      undefined;

    await upsertSubscriptionRow(
      {
        userId,
        stripeCustomerId,
        stripeSubscriptionId: sub.id,
        status: sub.status,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        currentPeriodEnd,
        stripePriceId: stripePriceIdFromSub || stripePriceIdFromInv,
        planType,
      },
      t
    );

    await upsertTransactionRow(
      {
        userId,
        stripeInvoiceId: inv.id,
        stripeCustomerId,
        stripeSubscriptionId,
        stripePriceId: stripePriceIdFromInv || stripePriceIdFromSub,
        amount:
          txStatus === "paid" ? inv.amount_paid || 0 : inv.amount_due || 0,
        currency: inv.currency || "aud",
        status: txStatus,
        paidAt:
          txStatus === "paid"
            ? unixToDate(inv.status_transitions?.paid_at)
            : null,
      },
      t
    );
  });
}

export async function createCheckoutSession(req, res) {
  try {
    const { type, userId, customerId, languageId } = req.body;

    const priceId = priceIdFromType(type);
    if (!priceId) return res.status(400).json({ error: "Invalid type" });
    if (!userId) return res.status(400).json({ error: "userId required" });

    const existingSub = await findActiveSubForUser(toInt(userId), languageId ? toInt(languageId) : null);
    if (existingSub) {
      return res.status(409).json({
        error: "User already has an active subscription. Use the upgrade endpoint to change plans.",
        upgradeEndpoint: "POST /api/v1/stripe/subscriptions/upgrade",
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `https://naati.prepsmart.au/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://naati.prepsmart.au/failure`,
      client_reference_id: String(userId),
      metadata: {
        userId: String(userId),
        planType: String(type),
        ...(languageId ? { languageId: String(languageId) } : {}),
      },
      subscription_data: {
        metadata: {
          userId: String(userId),
          planType: String(type),
          ...(languageId ? { languageId: String(languageId) } : {}),
        },
      },
      customer: customerId || undefined,
    });

    return res.status(200).json({ sessionId: session.id, url: session.url });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

export async function verifyCheckoutSession(req, res) {
  try {
    const sessionId =
      req.query.session_id || req.body.sessionId || req.body.session_id;
    if (!sessionId)
      return res.status(400).json({ error: "session_id required" });

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription"],
    });

    const subscription =
      session.subscription && typeof session.subscription === "object"
        ? session.subscription
        : null;

    const paid =
      session.status === "complete" &&
      (session.payment_status === "paid" ||
        (subscription &&
          (subscription.status === "active" ||
            subscription.status === "trialing")));

    let transactionCreated = false;

    if (paid && subscription) {
      const stripeCustomerId =
        typeof session.customer === "string"
          ? session.customer
          : session.customer?.id;

      await sequelize.transaction(async (t) => {
        const userId = await resolveUserIdFromAny({
          session,
          stripeSub: subscription,
          stripeCustomerId,
          t,
        });
        if (!userId || !stripeCustomerId) return;

        await User.update(
          { stripeCustomerId },
          { where: { id: userId }, transaction: t }
        );

        const currentPeriodEnd = getCurrentPeriodEndFromSub(subscription);
        const stripePriceId = getPriceIdFromSub(subscription);

        await upsertSubscriptionRow(
          {
            userId,
            stripeCustomerId,
            stripeSubscriptionId: subscription.id,
            status: subscription.status,
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            currentPeriodEnd,
            stripePriceId,
          },
          t
        );

        const fullSub = await stripe.subscriptions.retrieve(subscription.id, {
          expand: ["latest_invoice.lines.data.price", "items.data.price"],
        });

        let inv = fullSub.latest_invoice;

        if (typeof inv === "string") {
          inv = await stripe.invoices.retrieve(inv, {
            expand: ["lines.data.price"],
          });
        }

        if (!inv || !(inv.paid || inv.status === "paid")) {
          const invList = await stripe.invoices.list({
            subscription: subscription.id,
            limit: 5,
          });
          inv = invList.data.find((x) => x.paid || x.status === "paid") || null;
          if (inv?.id) {
            inv = await stripe.invoices.retrieve(inv.id, {
              expand: ["lines.data.price"],
            });
          }
        }

        if (inv && (inv.paid || inv.status === "paid")) {
          const invoicePriceId = getPriceIdFromInvoice(inv);

          await upsertTransactionRow(
            {
              userId,
              stripeInvoiceId: inv.id,
              stripeCustomerId,
              stripeSubscriptionId: subscription.id,
              stripePriceId: invoicePriceId || stripePriceId,
              amount: inv.amount_paid || 0,
              currency: inv.currency || "aud",
              status: "paid",
              paidAt: unixToDate(inv.status_transitions?.paid_at),
            },
            t
          );

          transactionCreated = true;
        }
      });
    }

    return res.status(200).json({
      paid,
      transactionCreated,
      session: {
        id: session.id,
        status: session.status,
        payment_status: session.payment_status,
        customer:
          typeof session.customer === "string"
            ? session.customer
            : session.customer?.id,
        subscription: subscription ? subscription.id : session.subscription,
      },
    });
  } catch (err) {
    return res.status(400).json({ error: err });
  }
}

export async function stripeWebhook(req, res) {
  try {
    const sig = req.headers["stripe-signature"];
    if (!sig)
      return res.status(400).send("Webhook Error: Missing stripe-signature");

    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      if (session.mode !== "subscription" || !session.subscription) {
        return res.status(200).json({ received: true, ignored: true });
      }

      const stripeCustomerId = session.customer;
      const stripeSubscriptionId = session.subscription;

      const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId, {
        expand: ["items.data.price", "latest_invoice"],
      });

      const planType = session.metadata?.planType || sub.metadata?.planType || null;
      const languageId = toInt(session.metadata?.languageId || sub.metadata?.languageId);

      await sequelize.transaction(async (t) => {
        const userId = await resolveUserIdFromAny({
          session,
          stripeSub: sub,
          stripeCustomerId,
          t,
        });
        if (!userId) return;

        const userUpdate = { stripeCustomerId };
        if (planType) userUpdate.subscriptionPlan = planType;
        await User.update(userUpdate, { where: { id: userId }, transaction: t });

        const currentPeriodEnd = getCurrentPeriodEndFromSub(sub);
        const stripePriceId = getPriceIdFromSub(sub);

        await upsertSubscriptionRow(
          {
            userId,
            stripeCustomerId,
            stripeSubscriptionId: sub.id,
            status: sub.status,
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            currentPeriodEnd,
            stripePriceId,
            planType,
            languageId,
          },
          t
        );
      });

      const latestInvoiceObj =
        typeof sub.latest_invoice === "string"
          ? await stripe.invoices.retrieve(sub.latest_invoice, {
              expand: ["lines.data.price"],
            })
          : sub.latest_invoice;

      if (
        latestInvoiceObj?.id &&
        (latestInvoiceObj.paid || latestInvoiceObj.status === "paid")
      ) {
        await sequelize.transaction(async (t) => {
          const userId = await resolveUserIdFromAny({
            session,
            stripeSub: sub,
            stripeCustomerId,
            t,
          });
          if (!userId) return;

          await upsertTransactionRow(
            {
              userId,
              stripeInvoiceId: latestInvoiceObj.id,
              stripeCustomerId,
              stripeSubscriptionId: sub.id,
              stripePriceId:
                getPriceIdFromInvoice(latestInvoiceObj) ||
                getPriceIdFromSub(sub),
              amount: latestInvoiceObj.amount_paid || 0,
              currency: latestInvoiceObj.currency || "aud",
              status: "paid",
              paidAt: unixToDate(latestInvoiceObj.status_transitions?.paid_at),
            },
            t
          );
        });
      }
    }

    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const sub = event.data.object;
      const stripeCustomerId = sub.customer;

      await sequelize.transaction(async (t) => {
        const userId = await resolveUserIdFromAny({
          stripeSub: sub,
          stripeCustomerId,
          t,
        });
        if (!userId) return;

        await User.update(
          { stripeCustomerId },
          { where: { id: userId }, transaction: t }
        );

        const currentPeriodEnd = getCurrentPeriodEndFromSub(sub);
        const stripePriceId = getPriceIdFromSub(sub);
        const planType =
          sub.metadata?.planType ||
          planTypeFromPriceId(stripePriceId) ||
          undefined;

        await upsertSubscriptionRow(
          {
            userId,
            stripeCustomerId,
            stripeSubscriptionId: sub.id,
            status: sub.status,
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            currentPeriodEnd,
            stripePriceId,
            planType,
          },
          t
        );
      });
    }

    if (
      event.type === "invoice.paid" ||
      event.type === "invoice.payment_succeeded"
    ) {
      await handleInvoiceCreateTransaction({
        invoiceId: event.data.object.id,
        txStatus: "paid",
      });
    }

    if (event.type === "invoice.payment_failed") {
      await handleInvoiceCreateTransaction({
        invoiceId: event.data.object.id,
        txStatus: "failed",
      });
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
}

export async function cancelUserSubscription(req, res) {
  try {
    const userId = toInt(req.body.userId ?? req.query.userId);
    const subParam = req.params.subscriptionId
      ? String(req.params.subscriptionId)
      : null;
    const cancelNowRaw = req.body.cancelNow ?? req.query.cancelNow ?? 0;
    const cancelNow =
      String(cancelNowRaw) === "1" ||
      String(cancelNowRaw).toLowerCase() === "true";

    if (!userId) return res.status(400).json({ error: "userId required" });
    if (!subParam)
      return res.status(400).json({ error: "subscriptionId required" });

    let row = null;

    if (subParam.startsWith("sub_")) {
      row = await Subscription.findOne({
        where: { userId, stripeSubscriptionId: subParam },
      });
    } else {
      const dbId = toInt(subParam);
      if (!dbId)
        return res.status(400).json({ error: "Invalid subscriptionId" });
      row = await Subscription.findByPk(dbId);
      if (row && Number(row.userId) !== Number(userId)) row = null;
    }

    if (!row) return res.status(404).json({ error: "Subscription not found" });

    let stripeSub = null;

    if (cancelNow) {
      stripeSub = await stripe.subscriptions.cancel(row.stripeSubscriptionId, {
        prorate: false,
      });
    } else {
      stripeSub = await stripe.subscriptions.update(row.stripeSubscriptionId, {
        cancel_at_period_end: true,
        expand: ["items.data.price"],
      });
    }

    const newStatus = cancelNow ? "canceled" : stripeSub.status;

    await sequelize.transaction(async (t) => {
      await row.update(
        {
          status: newStatus,
          cancelAtPeriodEnd: !!stripeSub.cancel_at_period_end,
          currentPeriodEnd: getCurrentPeriodEndFromSub(stripeSub),
          stripePriceId: getPriceIdFromSub(stripeSub),
        },
        { transaction: t }
      );
    });

    return res.json({
      success: true,
      data: {
        id: row.id,
        userId: row.userId,
        stripeSubscriptionId: row.stripeSubscriptionId,
        status: row.status,
        cancelAtPeriodEnd: row.cancelAtPeriodEnd,
        currentPeriodEnd: row.currentPeriodEnd,
        cancelNow,
      },
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function getUpgradeContext(userId, targetType, languageId) {
  const targetPriceId = priceIdFromType(targetType);
  if (!targetPriceId) throw Object.assign(new Error("Invalid targetType"), { status: 400 });

  const dbSub = await findActiveSubForUser(userId, languageId || null);
  if (!dbSub) throw Object.assign(new Error("No active subscription found"), { status: 400 });
  if (dbSub.planType === targetType) throw Object.assign(new Error("Already on this plan"), { status: 409 });
  if (dbSub.cancelAtPeriodEnd) {
    throw Object.assign(
      new Error("Subscription is set to cancel at period end. Reactivate it before upgrading."),
      { status: 400 }
    );
  }

  const stripeSub = await stripe.subscriptions.retrieve(dbSub.stripeSubscriptionId, {
    expand: ["items.data.price"],
  });

  const currentItem = stripeSub.items.data[0];
  if (!currentItem) throw Object.assign(new Error("Stripe subscription has no items"), { status: 400 });

  const targetPrice = await stripe.prices.retrieve(targetPriceId);
  const currentPrice = currentItem.price;

  if (currentPrice.currency !== targetPrice.currency) {
    throw Object.assign(
      new Error(`Currency mismatch: current plan is ${currentPrice.currency.toUpperCase()}, target is ${targetPrice.currency.toUpperCase()}`),
      { status: 400 }
    );
  }
  if (currentPrice.recurring?.interval !== targetPrice.recurring?.interval) {
    throw Object.assign(
      new Error(`Billing interval mismatch: current plan is ${currentPrice.recurring?.interval}, target is ${targetPrice.recurring?.interval}`),
      { status: 400 }
    );
  }

  return { dbSub, stripeSub, currentItem, targetPriceId, targetPrice };
}

export async function previewUpgrade(req, res) {
  try {
    const userId = toInt(req.body.userId);
    const { targetType, languageId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });
    if (!targetType) return res.status(400).json({ error: "targetType required" });

    const { stripeSub, currentItem, targetPriceId } = await getUpgradeContext(
      userId,
      targetType,
      languageId ? toInt(languageId) : null
    );

    const upcoming = await stripe.invoices.retrieveUpcoming({
      customer: stripeSub.customer,
      subscription: stripeSub.id,
      subscription_items: [{ id: currentItem.id, price: targetPriceId }],
      subscription_proration_behavior: "create_prorations",
    });

    const creditApplied = upcoming.lines.data
      .filter((l) => l.amount < 0)
      .reduce((sum, l) => sum + Math.abs(l.amount), 0);

    const nextBillingDate = upcoming.next_payment_attempt
      ? new Date(upcoming.next_payment_attempt * 1000).toISOString().slice(0, 10)
      : null;

    return res.json({
      currency: upcoming.currency,
      prorationAmount: upcoming.amount_due,
      immediateCharge: upcoming.amount_due,
      creditApplied,
      nextBillingDate,
      lineItems: upcoming.lines.data.map((l) => ({
        description: l.description,
        amount: l.amount,
        currency: l.currency,
      })),
    });
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}

export async function applyUpgrade(req, res) {
  try {
    const userId = toInt(req.body.userId);
    const { targetType, languageId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });
    if (!targetType) return res.status(400).json({ error: "targetType required" });

    const { dbSub, stripeSub, currentItem, targetPriceId } = await getUpgradeContext(
      userId,
      targetType,
      languageId ? toInt(languageId) : null
    );

    const updatedSub = await stripe.subscriptions.update(stripeSub.id, {
      items: [{ id: currentItem.id, price: targetPriceId }],
      proration_behavior: "create_prorations",
      payment_behavior: "error_if_incomplete",
      metadata: { planType: targetType },
      expand: ["latest_invoice.payment_intent"],
    });

    const latestInvoice = updatedSub.latest_invoice;
    const paymentIntent =
      latestInvoice && typeof latestInvoice === "object"
        ? latestInvoice.payment_intent
        : null;

    if (
      paymentIntent &&
      typeof paymentIntent === "object" &&
      paymentIntent.status === "requires_action"
    ) {
      return res.json({
        requiresAction: true,
        clientSecret: paymentIntent.client_secret,
      });
    }

    // Eagerly update the DB row so the UI reflects the change before the webhook fires.
    await dbSub.update({
      stripePriceId: targetPriceId,
      planType: targetType,
      status: updatedSub.status,
      currentPeriodEnd: getCurrentPeriodEndFromSub(updatedSub),
      cancelAtPeriodEnd: !!updatedSub.cancel_at_period_end,
    });

    return res.json({
      success: true,
      subscription: {
        id: dbSub.id,
        stripeSubscriptionId: updatedSub.id,
        planType: targetType,
        status: updatedSub.status,
        currentPeriodEnd: getCurrentPeriodEndFromSub(updatedSub),
        cancelAtPeriodEnd: !!updatedSub.cancel_at_period_end,
      },
    });
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
}
