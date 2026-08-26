import { Router } from "express";
import { User } from "../../models/User.js";
import { env } from "../../config/env.js";
import bcrypt from "bcryptjs";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const fac = req.headers["x-fac-code"];

    if (!fac || fac !== env.FAC_PEPPER) {
      return res.status(401).json({
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid FAC code",
        },
      });
    }

    const { fullName, email, phone, password } = req.body;

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({
        success: false,
        error: {
          code: "ALREADY_EXISTS",
          message: "Founder already exists",
        },
      });
    }

    const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);

    const founder = await User.create({
      fullName,
      email,
      phone,
      passwordHash,
      roles: ["founder"],
      primaryRole: "founder",
      profiles: [],
      status: "active",
      isVerified: true,
      verificationStatus: "approved",
    });

    return res.json({
      success: true,
      data: {
        userId: founder._id,
        role: founder.primaryRole,
        email: founder.email,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      error: {
        code: "SERVER_ERROR",
        message: "Internal server error",
      },
    });
  }
});

export default router;
