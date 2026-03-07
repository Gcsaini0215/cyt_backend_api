import { Router } from "express";

const router = Router();

router.get("/", (req, res, next) => {
  const host = req.get("host");
  console.log("✅ Backend request received on host:", host);

  res.status(200).json({
    status: true,
    message: "Welcome to ChooseYourTherapist API. Backend is running correctly.",
  });
});

export default router;
