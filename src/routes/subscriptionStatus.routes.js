import { Router } from "express";
import {
  getSubscriptionStatus,
  getAllSubscriptions,
  getSubOfAUser,
  getOneSub,
  updateSub,
  deleteSub,
} from "../controllers/subscriptionStatus.controller.js";

const router = Router();

router.get("/status/:userId", getSubscriptionStatus);

router.get("/", getAllSubscriptions);
router.get("/user/:userId", getSubOfAUser);

router.get("/:id", getOneSub);
router.put("/:id", updateSub);
router.delete("/:id", deleteSub);

export default router;
