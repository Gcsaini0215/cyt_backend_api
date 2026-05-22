import jwt from "jsonwebtoken";

const generateToken = (id, role, roleId = null) => {
  const payload = {
    userId: id,
    role: role,
    roleId: roleId,
  };
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
};

export default generateToken;
