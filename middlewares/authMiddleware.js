import Jwt from "jsonwebtoken";
import Users from "../models/Users.js";
import Admin from "../models/Admin.js";
import Role from "../models/Role.js";
import expressAsyncHandler from "express-async-handler";

export const isAuth = expressAsyncHandler(async (req, res, next) => {
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      
      token = req.headers.authorization.split(" ")[1];
      const decoded = Jwt.verify(token, process.env.JWT_SECRET);
      const user = await Users.findById(decoded.userId).select(
        "_id name email phone profile bio role"
      );

      if (user && user.role === 0) {
        req.user = user;
        next();
      } else {
        res.status(403);
        throw new Error("User is not authorized");
      }
    } catch (error) {
      res.status(401);
      throw new Error("User not authorized");
    }
  }

  if (!token) {
    res.status(401);
    throw new Error("Not authorized, No token found");
  }
});

export const isAuthCommon = expressAsyncHandler(async (req, res, next) => {
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      token = req.headers.authorization.split(" ")[1];
      const decoded = Jwt.verify(token, process.env.JWT_SECRET);

      const user = await Users.findById(decoded.userId).select(
        "_id name email phone profile bio role age gender dob"
      );

      if (user) {
        req.user = user;
        next();
      } else {
        res.status(403);
        throw new Error("User is not authorized");
      }
    } catch (error) {
      res.status(401);
      throw new Error("User not authorized");
    }
  }

  if (!token) {
    res.status(401);
    throw new Error("Not authorized, No token found");
  }
});

export const isTherapist = expressAsyncHandler(async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      token = req.headers.authorization.split(" ")[1];
      const decoded = Jwt.verify(token, process.env.JWT_SECRET);

      // Find the user and check the role
      const user = await Users.findById(decoded.userId).select(
        "name email phone profile bio role age gender dob"
      );

      if (user && decoded.role === 1) {
        req.user = user;
        next();
      } else {
        res.status(403);
        throw new Error("User is not authorized as a therapist");
      }
    } catch (error) {
      res.status(401);
      throw new Error("User not authorized");
    }
  }

  if (!token) {
    res.status(401);
    throw new Error("Not authorized, No token found");
  }
});

export const isSuperAdmin = expressAsyncHandler(async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    try {
      token = req.headers.authorization.split(" ")[1];
      const decoded = Jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.role !== 2) {
        res.status(403);
        throw new Error("Super admin access required");
      }
      const admin = await Admin.findById(decoded.userId).select("name email roleId");
      if (!admin || admin.roleId) {
        res.status(403);
        throw new Error("Super admin access required");
      }
      req.user = admin;
      next();
    } catch (error) {
      if (!res.statusCode || res.statusCode < 400) res.status(401);
      throw new Error(error.message || "Not authorized");
    }
  }
  if (!token) {
    res.status(401);
    throw new Error("Not authorized, No token found");
  }
});

export const hasPermission = (permKey) => expressAsyncHandler(async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    try {
      token = req.headers.authorization.split(" ")[1];
      const decoded = Jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.role !== 2) {
        res.status(403);
        throw new Error("Admin access required");
      }
      const admin = await Admin.findById(decoded.userId).select("name email roleId");
      if (!admin) {
        res.status(403);
        throw new Error("Admin not found");
      }
      if (!admin.roleId) {
        req.user = admin;
        return next();
      }
      const role = await Role.findById(admin.roleId).select("permissions");
      if (!role || !role.permissions.includes(permKey)) {
        res.status(403);
        throw new Error(`Access denied: missing permission '${permKey}'`);
      }
      req.user = admin;
      next();
    } catch (error) {
      if (!res.statusCode || res.statusCode < 400) res.status(401);
      throw new Error(error.message || "Not authorized");
    }
  }
  if (!token) {
    res.status(401);
    throw new Error("Not authorized, No token found");
  }
});

export const isAdmin = expressAsyncHandler(async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      token = req.headers.authorization.split(" ")[1];
      const decoded = Jwt.verify(token, process.env.JWT_SECRET);

      // Find the user and check the role
      let user = await Users.findById(decoded.userId).select(
        "name email phone profile bio role age gender dob"
      );

      // If not in Users, check in Admin collection
      if (!user) {
        user = await Admin.findById(decoded.userId).select(
          "name email profile designation"
        );
        if (user) {
          user.role = 2; // Treat Admin model users as role 2
        }
      }

      if (user && decoded.role === 2) {
        req.user = user;
        next();
      } else {
        res.status(403);
        throw new Error("User is not authorized as a admin");
      }
    } catch (error) {
      res.status(401);
      throw new Error("User not authorized");
    }
  }

  if (!token) {
    res.status(401);
    throw new Error("Not authorized, No token found");
  }
});
