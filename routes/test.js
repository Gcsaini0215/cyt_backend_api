import { Router } from "express";

const router = Router();

router.get("/", (req, res, next) => {
  const host = req.get("host");
  console.log("✅ Backend request received on host:", host);

  if (host && (host.includes("api") || host.includes("localhost") || host.includes("127.0.0.1"))) {
    res.status(200).json({
      status: true,
      message: "Welcome to ChooseYourTherapist API. Backend is running correctly.",
    });
  } else {
    // If it's not the API domain, we should probably not be serving this message.
    // However, since we don't have the frontend here, we'll just fall through to the 404 handler.
    next();
  }
});

export default router;
