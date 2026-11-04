import { Router } from "express";
import { getFestivalOffer, getFestivalGift, setFestivalGiftRecipient, bookFestivalGift, myFestivalGifts } from "../controllers/FestivalController.js";
import { isAuth } from "../middlewares/authMiddleware.js";
import { leadRateLimit, phoneLookupRateLimit } from "../middlewares/rateLimitMiddleware.js";

// Festival "book 1, get 1 free" (/festival-therapy). The paid session books through /noida-appointments with `offer`.
const router = Router();

router.get("/festival-offers/current", leadRateLimit, getFestivalOffer);    // public
router.get("/festival-gifts/mine", isAuth, myFestivalGifts);               // client: My Space
router.get("/festival-gifts/:code", phoneLookupRateLimit, getFestivalGift); // public — the code is the secret
router.patch("/festival-gifts/:code", leadRateLimit, setFestivalGiftRecipient);
router.post("/festival-gifts/:code/book", leadRateLimit, bookFestivalGift);

export default router;
