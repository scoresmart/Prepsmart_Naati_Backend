import { Transaction } from "../models/transaction.model.js";

export async function createTransaction(req, res) {
  try {
    const tx = await Transaction.create(req.body);
    return res.status(201).json(tx);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
}

export async function listTransactions(req, res) {
  try {
    const { userId, limit = 50, offset = 0 } = req.query;

    const where = {};
    if (userId) where.userId = userId;

    const rows = await Transaction.findAll({
      where,
      order: [["id", "DESC"]],
      limit: Number(limit),
      offset: Number(offset)
    });

    return res.json(rows);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
}

export async function getTransaction(req, res) {
  try {
    const tx = await Transaction.findByPk(req.params.id);
    if (!tx) return res.status(404).json({ error: "Not found" });
    return res.json(tx);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
}

export async function updateTransaction(req, res) {
  try {
    const tx = await Transaction.findByPk(req.params.id);
    if (!tx) return res.status(404).json({ error: "Not found" });

    await tx.update(req.body);
    return res.json(tx);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
}

export async function deleteTransaction(req, res) {
  try {
    const tx = await Transaction.findByPk(req.params.id);
    if (!tx) return res.status(404).json({ error: "Not found" });

    await tx.destroy();
    return res.json({ deleted: true });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
}
