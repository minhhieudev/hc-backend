import Customer from "../models/customer.model.js";
import ServicePackage from "../models/service-package.model.js";
import instance1DgmeService from "./_1dgme.service.js";
import OngtrumService from "./ongtrum.service.js";
import _ from "lodash";
import redisServiceIntance from "./redis.service.js";
import CalculateDashboardService from "./calculate-dashboard.service.js";
import { CacheDashboardRedis } from "../common/redis.contanst.js";

const colors = [
  "#8E44AD",
  "#17A589",
  "#F1C40F",
  "#ECF0F1",
  "#34495E",
  "#F0ECE2",
  "#E74C3C",
  "#85C1E9",
  "#45B39D",
  "#DC7633",
  "#EC7063",
];

const cacheDashboardTtl = 86400;

class DashboardService {
  constructor() {
    this.calculateDashboardService = new CalculateDashboardService();
    this.getPlatform = this.getPlatform.bind(this);
    this.getPartner = this.getPartner.bind(this);
    this.getOrder = this.getOrder.bind(this);
    this.getServiceList = this.getServiceList.bind(this);
    this.getRechargeList = this.getRechargeList.bind(this);
    this.getOrderList = this.getOrderList.bind(this);
    this.getSystem = this.getSystem.bind(this);
  }

  async getPlatform(req, res) {
    try {
      const { dataType = "order", type = 0 } = req.query;
      let [data, hasOrderChange] = await Promise.all([
        redisServiceIntance.get(
          `${CacheDashboardRedis.cacheStatisticPlatformKey}-${type}-${dataType}`
        ),
        redisServiceIntance.get(CacheDashboardRedis.orderChange),
      ]);

      if (!data || hasOrderChange?.status) {
        redisServiceIntance.set(
          CacheDashboardRedis.orderChange,
          { status: false },
          cacheDashboardTtl
        );

        data = await this.calculateDashboardService.calculateStatisticPlatform(
          type,
          dataType
        );
        redisServiceIntance.set(
          `${CacheDashboardRedis.cacheStatisticPlatformKey}-${type}-${dataType}`,
          data,
          cacheDashboardTtl
        );
      }

      res.status(200).json({
        success: true,
        data: {
          colors,
          chart: data,
        },
      });
    } catch (error) {
      console.log("error: ", error);
      return res.status(200).send({
        success: false,
        alert: "error",
        message: `${error}`,
        error,
      });
    }
  }

  async getPartner(req, res) {
    try {
      const { type = 0, dataType = "order" } = req.query;
      let [data, hasOrderChange] = await Promise.all([
        redisServiceIntance.get(
          `${CacheDashboardRedis.cacheStatisticGetPartner}-${type}-${dataType}`
        ),
        redisServiceIntance.get(CacheDashboardRedis.orderChange),
      ]);

      if (!data || hasOrderChange?.status) {
        redisServiceIntance.set(
          CacheDashboardRedis.orderChange,
          { status: false },
          cacheDashboardTtl
        );

        data = await this.calculateDashboardService.calculateGetPartner(
          type,
          dataType
        );

        redisServiceIntance.set(
          `${CacheDashboardRedis.cacheStatisticGetPartner}-${type}-${dataType}`,
          data,
          cacheDashboardTtl
        );
      }

      res.status(200).json({
        success: true,
        data: {
          ...data,
          colors,
        },
      });
    } catch (error) {
      console.log("error: ", error);
      return res.status(200).send({
        success: false,
        alert: "error",
        message: `${error}`,
        error,
      });
    }
  }

  async getSystem(req, res) {
    try {
      // lấy số dư ongtrum
      const ongtrumService = new OngtrumService();
      let [
        balanceOngtrum,
        balance1DG,
        totalCustomer,
        totalSerivce,
        customerWallet,
        hasPaymentActivityChange,
      ] = await Promise.all([
        ongtrumService.getBalance(),
        instance1DgmeService.getBalance(),
        Customer.countDocuments(),
        ServicePackage.countDocuments(),
        redisServiceIntance.get(CacheDashboardRedis.cacheCustomerWallet),
        redisServiceIntance.get(CacheDashboardRedis.paymentActivityChange),
      ]);

      // kiểm tra số tiền trong ví của những người dùng
      if (!customerWallet || hasPaymentActivityChange?.status) {
        redisServiceIntance.set(
          CacheDashboardRedis.paymentActivityChange,
          { status: false },
          cacheDashboardTtl
        );
        customerWallet =
          await this.calculateDashboardService.calculateCustomerWallet();
        redisServiceIntance.set(
          CacheDashboardRedis.cacheCustomerWallet,
          customerWallet,
          cacheDashboardTtl
        );
      }

      const data = {
        totalCustomer,
        totalSerivce,
        balance1DG,
        balanceOngtrum,
        customerWallet,
      };

      res.status(200).json({
        success: true,
        data,
      });
    } catch (error) {
      console.log("error: ", error);
      return res.status(200).send({
        success: false,
        alert: "error",
        message: `${error}`,
        error,
      });
    }
  }

  async getOrder(req, res) {
    const { type = 0, dataType = "order,money,revenue" } = req.query;
    try {
      if (type > 2) {
        throw "_";
      }

      let [data, hasOrderChange] = await Promise.all([
        redisServiceIntance.get(
          `${CacheDashboardRedis.cacheStatisticOrderKey}-${type}-${dataType}`
        ),
        redisServiceIntance.get(CacheDashboardRedis.orderChange),
      ]);

      if (hasOrderChange?.status || !data) {
        redisServiceIntance.set(
          CacheDashboardRedis.orderChange,
          { status: false },
          cacheDashboardTtl
        );

        data = await this.calculateDashboardService.calculateStatisticOrder(
          type,
          dataType
        );

        redisServiceIntance.set(
          `${CacheDashboardRedis.cacheStatisticOrderKey}-${type}-${dataType}`,
          data,
          cacheDashboardTtl
        );
      }

      res.status(200).json({
        success: true,
        data,
      });
    } catch (error) {
      console.log("error: ", error);
      return res.status(200).send({
        success: false,
        alert: "error",
        message: `${error}`,
        error,
      });
    }
  }

  async getServiceList(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const pageSize = parseInt(req.query.pageSize) || 10;
      const { search, type = 0 } = req.query;

      // Cache data
      let [hasOrderChange, servicePackages] = await Promise.all([
        redisServiceIntance.get(CacheDashboardRedis.orderChange),
        redisServiceIntance.get(
          CacheDashboardRedis.cacheServiceListKey + `-${type}`
        ),
      ]);

      if (hasOrderChange?.status || !servicePackages) {
        redisServiceIntance.set(
          CacheDashboardRedis.orderChange,
          { status: false },
          cacheDashboardTtl
        );
        servicePackages =
          await this.calculateDashboardService.calculateServiceList(type);
        redisServiceIntance.set(
          CacheDashboardRedis.cacheServiceListKey + `-${type}`,
          servicePackages,
          cacheDashboardTtl
        );
      }

      // Filter
      let filteredResults = servicePackages;
      if (search) {
        const lowerCaseQuery = search.toLowerCase();
        filteredResults = filteredResults.filter((item) =>
          item.name.toLowerCase().includes(lowerCaseQuery)
        );
      }

      // Pagination
      const startIndex = (page - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      const servicePackageResponse = filteredResults.slice(
        startIndex,
        endIndex
      );
      const total = filteredResults.length;
      const totalPages = Math.ceil(total / pageSize);
      const pagination = {
        page,
        pageSize,
        total,
        totalPages,
      };

      res.status(200).json({
        success: true,
        data: {
          pagination,
          servicePackages: servicePackageResponse,
        },
      });
    } catch (error) {
      console.log("error: ", error);
      return res.status(200).send({
        success: false,
        alert: "error",
        message: `${error}`,
        error,
      });
    }
  }

  async getRechargeList(req, res) {
    try {
      const { type = 0 } = req.query;
      let [rechargeList, hasPaymentActivityChange] = await Promise.all([
        redisServiceIntance.get(
          `${CacheDashboardRedis.cacheRechargeList}-${type}`
        ),
        redisServiceIntance.get(CacheDashboardRedis.paymentActivityChange),
      ]);

      if (!rechargeList || hasPaymentActivityChange?.status) {
        redisServiceIntance.set(
          CacheDashboardRedis.paymentActivityChange,
          { status: false },
          cacheDashboardTtl
        );

        rechargeList =
          await this.calculateDashboardService.calculateGetRechargeList(type);

        redisServiceIntance.set(
          `${CacheDashboardRedis.cacheRechargeList}-${type}`,
          rechargeList,
          cacheDashboardTtl
        );
      }

      res.status(200).json({
        success: true,
        data: rechargeList,
      });
    } catch (error) {
      console.log("error: ", error);
      return res.status(200).send({
        success: false,
        alert: "error",
        message: `${error}`,
        error,
      });
    }
  }

  async getOrderList(req, res) {
    try {
      const { type = 0 } = req.query;

      let [data, hasOrderChange] = await Promise.all([
        redisServiceIntance.get(
          `${CacheDashboardRedis.cacheOrderListKey}-${type}`
        ),
        redisServiceIntance.get(CacheDashboardRedis.orderChange),
      ]);

      if (!data || hasOrderChange?.status) {
        redisServiceIntance.set(
          CacheDashboardRedis.orderChange,
          { status: false },
          cacheDashboardTtl
        );
        data = await this.calculateDashboardService.calculateGetOrderList(type);
        redisServiceIntance.set(
          `${CacheDashboardRedis.cacheOrderListKey}-${type}`,
          data,
          cacheDashboardTtl
        );
      }

      res.status(200).json({
        success: true,
        data,
      });
    } catch (error) {
      console.log("error: ", error);
      return res.status(200).send({
        success: false,
        alert: "error",
        message: `${error}`,
        error,
      });
    }
  }
}
export default DashboardService;
