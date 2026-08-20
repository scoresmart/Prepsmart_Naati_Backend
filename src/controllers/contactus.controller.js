// controllers/contactMessage.controller.js
import { ContactMessage } from "../models/contactUs.js";

export const createContactMessage = async (req, res) => {
  try {
    const { firstName, lastName, email, phoneNumber, subject, message } = req.body;

    if (!firstName || !email || !subject || !message) {
      return res.status(400).json({
        success: false,
        message: "firstName, email, subject, message are required",
      });
    }

    const row = await ContactMessage.create({
      firstName,
      lastName: lastName || null,
      email,
      phoneNumber: phoneNumber || null,
      subject,
      message,
    });

    return res.status(201).json({ success: true, data: row });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getAllContactMessages = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 100);
    const offset = (page - 1) * limit;

    const { rows, count } = await ContactMessage.findAndCountAll({
      limit,
      offset,
      order: [["createdAt", "DESC"]],
    });

    return res.json({
      success: true,
      data: rows,
      meta: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getContactMessageById = async (req, res) => {
  try {
    const { id } = req.params;

    const row = await ContactMessage.findByPk(id);
    if (!row) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    return res.json({ success: true, data: row });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const updateContactMessage = async (req, res) => {
  try {
    const { id } = req.params;

    const row = await ContactMessage.findByPk(id);
    if (!row) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    // allow updating any of these fields
    const allowed = ["firstName", "lastName", "email", "phoneNumber", "subject", "message"];
    const updates = {};

    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        updates[key] = req.body[key];
      }
    }

    await row.update(updates);
    return res.json({ success: true, data: row });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteContactMessage = async (req, res) => {
  try {
    const { id } = req.params;

    const row = await ContactMessage.findByPk(id);
    if (!row) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    await row.destroy();
    return res.json({ success: true, message: "Deleted" });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
