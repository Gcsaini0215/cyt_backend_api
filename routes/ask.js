import express from "express";
import { isAuth, isTherapist, hasPermission } from "../middlewares/authMiddleware.js";
import {
  askQuestion, myQuestions, publicList, publicOne, publicSlugs, markHelpful,
  therapistList, claimQuestion, answerQuestion, adminList, adminUpdate, adminDelete,
} from "../controllers/AskController.js";

// "Ask a psychologist" (client dashboard → therapist answers → admin publishes)
const router = express.Router();

router.post("/ask/questions", isAuth, askQuestion);
router.get("/ask/questions/mine", isAuth, myQuestions);

router.get("/ask/public", publicList);
router.get("/ask/public-slugs", publicSlugs);
router.get("/ask/public/:slug", publicOne);
router.post("/ask/public/:slug/helpful", markHelpful);

router.get("/ask/therapist", isTherapist, therapistList);
router.post("/ask/therapist/:id/claim", isTherapist, claimQuestion);
router.post("/ask/therapist/:id/answer", isTherapist, answerQuestion);

router.get("/ask/admin", hasPermission("blogs"), adminList);
router.patch("/ask/admin/:id", hasPermission("blogs"), adminUpdate);
router.delete("/ask/admin/:id", hasPermission("blogs"), adminDelete);

export default router;
