import axios, { HttpStatusCode } from "axios";
import Wallet from "../models/wallet.model.js";
import qs from "qs";
import PaymentActivity from "../models/payment-activity.model.js";
import moment from "moment";
import _ from "lodash";
import config from "../configs/config.js";
import { convertUSDToVND } from "../utils/function.js";
import Setting from "../models/setting.model.js";
import { generateCode } from "../utils/function.js";
import Customer from "../models/customer.model.js";
import translations from "../common/translate-mess-response.json" assert { type: "json" };

class PaymentService {
  constructor() {
    this.rechargeByPaypal = this.rechargeByPaypal.bind(this);
    this.checkRechargeByBank = this.checkRechargeByBank.bind(this);
  }

  async rechargeByPaypal(req, res) {
    const lang = req.header.lang;
    try {
      const { body, user } = req;
      // lấy thông tin ví
      const wallet = await Wallet.findOne({
        customer: user._id,
      });

      if (wallet.status == "block") {
        throw translations.walletBlocked[lang]
      }

      // check type thanh toán
      if (body.type != "recharge") {
        throw translations.requestDecline[lang];
      }

      const [username, password, isUsePaypal] = await Promise.all([
        Setting.findOne({ key: "paypalClientID" }).lean(),
        Setting.findOne({ key: "paypalClientSecret" }).lean(),
        Setting.findOne({ key: "isUsePaypal" }).lean(),
      ]);

      if (!username.value || !password.value) {
        throw {
          message:
           translations.paypalNotSetup[lang]
        };
      }

      if (isUsePaypal.value === "false" || !isUsePaypal.value) {
        throw {
          message: translations.functionNotAvailable[lang],
        };
      }

      // login paypal
      const orderPaypal = await checkOrderPaypal(
        body?.order?.id,
        username,
        password
      );

      if (orderPaypal.status == "COMPLETED" && orderPaypal.amount) {
        // kiểm tra order đã đc nạp?
        const checkUsing = await PaymentActivity.find({
          transaction: body?.order?.id,
          status: "success",
        });

        if (!_.isEmpty(checkUsing)) {
          throw translations.transactionSettled[lang];
        }

        // tạo một thanh toán
        const amountConveted = await convertUSDToVND(orderPaypal.amount);
        const detailDiscount = await this.calculateAmountAfterDiscount(
          amountConveted
        );
        const amountAfterDiscount = detailDiscount.newAmount;
        const newBalance = +wallet.balance + amountAfterDiscount;
        const time = moment().utcOffset(420).format("HH:mm DD/MM/YYYY");
        let message = `${translations.depositSuccess[lang]} ${orderPaypal.amount}$ ${translations.at[lang]} ${time}`;

        if (amountAfterDiscount > amountConveted) {
          message += `\n${translations.bonus[lang]}: ${detailDiscount.discountPercent}% ${translations.loadedValue[lang]}`;
        }

        await PaymentActivity.create({
          transaction: body?.order?.id,
          customer: user._id,
          type: "paypal",
          amount: amountConveted,
          oldBalance: wallet.balance,
          newBalance,
          wallet: wallet._id,
          status: "success",
          description: message,
          depositDiscountPercent: detailDiscount.discountPercent,
        });

        await wallet.updateOne({
          $inc: {
            balance: +amountAfterDiscount,
            totalRecharged: +amountConveted,
          },
        });
      } else {
        throw translations.checkPaypalInvoiceFailed[lang];
      }

      res.status(200).send({
        success: true,
        message: translations.depositSuccess[lang],
      });
    } catch (error) {
      console.log({ error });
      res.status(200).send({
        success: false,
        message: error?.message || translations.depositFailed[lang],
        error,
      });
    }
  }

  async rechargeByAdmin(req, res) {
    const lang = req.header.lang;
    try {
      const { amount, note, customerID } = req.body;

      // lấy thông tin ví
      const wallet = await Wallet.findOne({
        customer: customerID,
      });

      if (!wallet) {
        throw translations.walletNotExist[lang];
      }

      // Update wallet
      await wallet.updateOne({
        $inc: { balance: amount, totalRecharged: amount },
      });

      const transactionID = generateCode("AD");

      const newBalance = wallet.balance + amount;

      // Update payment activity
      await PaymentActivity.create({
        transaction: transactionID,
        customer: customerID,
        type: "admin",
        amount,
        oldBalance: +wallet.balance,
        newBalance: newBalance,
        wallet: wallet._id,
        status: "success",
        description: note,
      });

      res.status(200).send({
        success: true,
        message: translations.depositSuccess[lang],
      });
    } catch (error) {
      console.log({ error });
      res.status(200).send({
        success: false,
        message: error?.message || translations.depositFailed[lang],
        error,
      });
    }
  }

  async checkRechargeByBank() {
    try {
      const accessToken = await Setting.findOne({ key: "apiBankKey" })
        .select("value")
        .lean();
      if (!accessToken?.value) {
        return;
      }

      let url = `https://api.apithanhtoan.com/api/history?offset=0&limit=20&memo=&accountNumber=&accessToken=${accessToken.value}&bankCode=vcb`;
      let rs = await fetch(url)
        .then((res) => res.json())
        .then((data) => {
          if (data && data.data) {
            return data;
          }
          return null;
        })
        .catch((err) => {
          console.log("Error while get check bank history ", err);
          return null;
        });

      if (!rs || !Array.isArray(rs.data)) {
        console.log("Not found payment results");
        return;
      }

      const [prefixSetting, suffixSetting] = await Promise.all([
        Setting.findOne({ key: "bankPrefix" }).select("value").lean(),
        Setting.findOne({ key: "bankSuffix" }).select("value").lean()
      ]);

      let prefix, suffix
      if (prefixSetting) {
        prefix = prefixSetting.value
      }
      if (suffixSetting) {
        suffix = suffixSetting.value
      }
      if (!prefix || !suffix) {
        console.info('Missing prefix or suffix setting', {
          prefix,
          suffix,
        })
        return;
      }

      for await (let item of rs.data) {
        item.memo = item.memo.toUpperCase();
        item.memo = item.memo.split('.').pop()

        const pattern = `${prefix}(\\d+)${suffix}`

        let paymentCode = "";
        const matched = new RegExp(pattern, 'i').exec(item.memo)
        if (matched && matched[1]) {
          paymentCode = matched[1]
        } else {
          continue;
        }

        if (item.type == "deposit" && item.money.startsWith("+")) {
          let totalReCharge = Number(item.money.replace(/[,|+]/g, ""));
          const ref = item.referenceNumber;

          // check exist payment
          const exist = await PaymentActivity.exists({
            transaction: `$BANK${ref}`,
            type: "bank",
          });
          
          if (exist) {
            return;
          }

          console.log('-DEBUG- thực hiện nạp tiền cho ', paymentCode)
          const customer = await Customer.findOne({
            paymentCode,
          });

          if (customer) {
            const wallet = await Wallet.findOne({
              customer: customer._id,
            });

            if (wallet) {
              try {
                const detailDiscount = await this.calculateAmountAfterDiscount(totalReCharge);
                const amountAfterDiscount = detailDiscount.newAmount;
                const newBalance = wallet.balance + amountAfterDiscount;
                let message = `Nạp thành công ${totalReCharge} VND qua ngân hàng`;

                if (amountAfterDiscount > totalReCharge) {
                  message += `\nTặng thêm: ${detailDiscount.discountPercent}% giá trị nạp`;
                }

                // Update wallet, payment activity
                await Promise.all([
                  PaymentActivity.create({
                    transaction: `$BANK${ref}`,
                    oldBalance: wallet.balance,
                    newBalance,
                    customer: customer._id,
                    wallet: wallet._id,
                    amount: totalReCharge,
                    type: "bank",
                    status: "success",
                    description: message,
                    depositDiscountPercent: detailDiscount.discountPercent
                  }),

                  wallet.updateOne({
                    $inc: {
                      totalRecharged: amountAfterDiscount,
                      balance: amountAfterDiscount,
                    },
                  }),
                ]);
              } catch (error) {
                console.log(error);
              }
            }
          } else {
            console.log("Customer not found");
          }
        }
      }
    } catch (error) {
      console.log("error while check payments", error);
    }
  }

  async calculateAmountAfterDiscount(amount) {
    const depositDiscount = await Setting.findOne({ key: "depositDiscount" })
      .select("value")
      .lean();

    const discounts = depositDiscount.value;

    if (discounts.length === 0) return 0;

    const maxDiscount =
      discounts
        .filter((data) => amount >= data.amount)
        .reduce((max, current) => {
          if (!max || current.discountPercent > max.discountPercent) {
            return current;
          }
          return !max || current.discountPercent > max.discountPercent
            ? current
            : max;
        }, 0).discountPercent || 0;

    const newAmount = Math.floor(amount + (maxDiscount / 100) * amount) || 0;

    return { newAmount, discountPercent: maxDiscount };
  }
}

export default PaymentService;

const checkOrderPaypal = async (orderId, username, password) => {
  const BuAccount = {
    username: username.value,
    password: password.value,
  };

  const PPAPI = {
    login: config.paypal.apiLogin,
    checkOrder: config.paypal.apiCheckOrder,
  };

  try {
    const token = `${BuAccount.username}:${BuAccount.password}`;
    const encodedToken = Buffer.from(token).toString("base64");

    const paypalUser = await axios({
      method: "POST",
      data: qs.stringify({
        grant_type: "client_credentials",
      }),
      url: PPAPI.login,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${encodedToken}`,
      },
    });

    if (paypalUser.status == HttpStatusCode.Ok) {
      const accessToken = paypalUser?.data?.access_token;
      const checkOrder = await axios({
        method: "GET",
        url: `${PPAPI.checkOrder}${orderId}`,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (checkOrder.status == HttpStatusCode.Ok) {
        console.log(checkOrder.data);
        return {
          status: checkOrder.data.status,
          amount: Number(checkOrder.data.purchase_units[0].amount.value),
        };
      }
    }
  } catch (error) {
    console.error({
      type: "Check order paypal",
      error,
    });
    return "FAIL";
  }
};
