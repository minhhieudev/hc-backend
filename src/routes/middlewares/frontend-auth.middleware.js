import jwt from "jsonwebtoken";
import config from "../../configs/config.js";
import Customer from "../../models/customer.model.js";
import redisServiceIntance from "../../services/redis.service.js";
import translations from "../../common/translate-mess-response.json" assert { type: "json" };

async function FrontendAuthMiddleware(req, res, next) {
  try {
    const token = (req.header.authorization || "")
      .toString()
      .replace("Bearer ", "");

    if (!token) {
      return res.status(403).json({
        success: false,
        message: "Access denied. No token provided.",
      });
    }

    let payload;
    jwt.verify(token, config.api.customer.accessTokenKey, (err, result) => {
      if (err) {
        if (err?.name === "TokenExpiredError")
          throw "Phiên đăng nhập đã hết hạn. Xin vui lòng đăng nhập lại";
        else throw "Tài khoản hoặc mật khẩu không chính xác";
      } else payload = result;
    });

    let status;
    const language = req?.header?.lang || "vi";
   
    // Check Redis
    const value = await redisServiceIntance.get(`cus-${payload._id}`);
    if (!value?.status) {
      const checkCustomer = await Customer.findById(payload._id)
        .select("status apiKey")
        .lean();

      await redisServiceIntance.set(
        `cus-${checkCustomer._id.toString()}`,
        checkCustomer
      );

      status = checkCustomer?.status;
    } else {
      status = value?.status;
    }

    if (status === "blocked") {
      return res.status(403).json({
        success: false,
        alert: "error",
        message: translations.customerBlockedMessage[language],
      });
    }

    req.user = payload;

    next();
  } catch (error) {
    console.log({ error });

    return res.status(401).json({
      success: false,
      message: error,
    });
  }
}

export default FrontendAuthMiddleware;
