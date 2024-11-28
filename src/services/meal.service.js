import Meal from "../models/meal.model.js";
import MealReviewModel from "../models/meal-review.model.js";
import { caching } from "cache-manager";
import translations from "../common/translate-mess-response.json" assert { type: "json" };

const memoryCache = await caching("memory", {
  max: 100,
  ttl: 10 * 1000,
});

class MealService {

  async updateFavoriteIngredients (req, res) {
    console.log('Favo')
    const { favoriteIngredients, mealID } = req.body
    
    console.log('favoriteIngredients:', favoriteIngredients)
    console.log('mealID:', mealID)

    try {
      if (favoriteIngredients && mealID) {
        await Meal.updateOne({ _id: mealID }, { favoriteIngredients: favoriteIngredients })
        return res.status(200).json({
          success: true,
        });
      }
    } catch (error) {
      console.error('Error while updateFavoriteIngredients', error)
      return res.json({
        success: false,
        alert: "error",
        message: `${error.message}`,
        error,
      });
    }
  }

  async updateDeliveryTime (req, res) {
    console.log('date')

    const { estimatedDate, estimatedTime, mealID } = req.body
    console.log('estimatedDate:', estimatedDate)
    console.log('estimatedTime:', estimatedTime)
    console.log('mealID:', mealID)


    try {
      if (estimatedDate && estimatedTime && mealID) {
        // TODO validate data
        await Meal.updateOne({ _id: mealID }, { estimatedDate, estimatedTime })
        return res.status(200).json({
          success: true,
        });
      }
      return res.json({ success: false, message: 'Missing data' });
    } catch (error) {
      console.error('Error while updateDeliveryTime', error)
      return res.json({
        success: false,
        alert: "error",
        message: `${error.message}`,
        error,
      });
    }
  }

  async addReview (req, res) {
    console.log('rewwiew')

    const { rating, content, mealID, customerID } = req.body
    console.log('customerID:', customerID)
    console.log('mealID:', mealID)
    console.log('content:', content)
    console.log('rating:', rating)


    try {
      if (rating && content && mealID && customerID) {
        // TODO validate data
        const meal = await Meal.findOne({ _id: mealID }).lean()
        if (meal) {
          await MealReviewModel.create({
            content,
            rating,
            mealID,
            customerID,
          })
          return res.json({
            success: true,
          });
        }
        return res.json({
          success: false,
          message: 'Meal not found'
        });
      }
      return res.json({ success: false, message: 'Missing data' });
    } catch (error) {
      console.error('Error while addReview', error)
      return res.json({
        success: false,
        alert: "error",
        message: `${error.message}`,
        error,
      });
    }
  }

  async cancelMeal (req, res) {
    console.log('cancel')

    const { mealID } = req.body
    console.log('mealID:', mealID)

    try {
      if (mealID) {
        // TODO validate data
        await Meal.updateOne({ _id: mealID }, { status: 'cancelled' })
        
        return res.json({
          success: true,
        });
      }
      return res.json({ success: false, message: 'Missing data' });
    } catch (error) {
      console.error('Error while cancelMeal', error)
      return res.json({
        success: false,
        alert: "error",
        message: `${error.message}`,
        error,
      });
    }
  }
  
  // async gets(req, res) {
  //   try {
  //     const page = parseInt(req.query.page) || 1;
  //     const pageSize = parseInt(req.query.pageSize) || 20;
  //     const skip = (page - 1) * pageSize;
  //     const { search } = req.query;

  //     let filter = {};

  //     // Check for search 
  //     if (search) {
  //       const searchFields = ["name"];
  //       const cond = searchFields.map((field) => {
  //         return { [field]: { $regex: new RegExp(search, "i") } };
  //       });
  //       filter = { $or: cond };
  //     }

  //     // Check cache 
  //     const cacheKey = search ? null : "Meals";
  //     let meals;
  //     if (cacheKey) {
  //       meals = await memoryCache.get(cacheKey);
  //     }

  //     if (!meals) {
  //       meals = await Meal.find(filter)
  //         .select("-__v -createdAt -updatedAt")
  //         .sort({ createdAt: -1 })
  //         .lean()
  //         .skip(skip)
  //         .limit(pageSize);
        
  //       if (cacheKey) {
  //         const ttl = 6 * 60 * 1000;
  //         await memoryCache.set(cacheKey, meals, ttl);
  //       }
  //     }

  //     const total = await Meal.countDocuments(filter);
  //     const totalPages = Math.ceil(total / pageSize);

  //     const pagination = {
  //       total,
  //       page,
  //       pageSize,
  //       totalPage: totalPages,
  //     };

  //     res.status(200).json({
  //       success: true,
  //       data: { meals, pagination },
  //     });
  //   } catch (error) {
  //     console.log("error: ", error);
  //     return res.status(500).send({
  //       success: false,
  //       alert: "error",
  //       message: `${error}`,
  //       error,
  //     });
  //   }
  // }

  async getOne(req, res) {
    try {
      console.log(req.params)
      const { id } = req.params;
      const meal = await Meal.findOne({ _id: id })
        .select("estimatedDate estimatedTime")
        .populate("favoriteIngredients")
        .lean();

      if (!meal) throw "Thành phần không tồn tại";

      res.status(200).send({
        success: true,
        data: { meal },
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

  async create(req, res) {
    try {
      console.log(req.body)
      const data = req.body;
      const lang = req.headers.lang;

      const newMeal = new Meal(data);
      await newMeal.save();

      // Clear cache
      await memoryCache.del("Meals");

      res.status(200).send({
        success: true,
        message: translations.addSuccess[lang],
        data: newMeal,
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

  async update(req, res) {
    try {
      const { id } = req.params;
      const data = req.body;
      const lang = req.headers.lang || "en";

      const updatedMeal = await Meal.findByIdAndUpdate(id, data, {
        new: true,
        runValidators: true,
      }).lean();

      if (!updatedMeal) {
        throw translations.mealNotExist[lang];
      }

      // Clear cache
      await memoryCache.del("Meals");

      res.status(200).send({
        success: true,
        message: translations.updateSuccess[lang],
        data: updatedMeal,
      });
    } catch (error) {
      console.log("error: ", error);
      return res.status(500).send({
        success: false,
        alert: "error",
        message: `${error}`,
        error,
      });
    }
  }

  async delete(req, res) {
    try {
      const { id } = req.params;
      const lang = req.headers.lang || "en";

      const meal = await Meal.exists({ _id: id });

      if (!meal) {
        throw translations.mealNotExist[lang];
      }

      await Meal.findOneAndDelete({ _id: id });

      // Clear cache
      await memoryCache.del("Meals");

      res.status(200).json({
        success: true,
        message: translations.deleteSuccess[lang],
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
  async gets(req, res) {
    try {
      const { id } = req.params;

      const meals = await Meal.find({orderID: id}).sort({ estimatedDate: 1 })
        .lean()
        .sort({ createdAt: -1 })
        .select("-__v -createdAt -updatedAt ")

      res.status(200).json({
        success: true,
        data: { meals },
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

export default MealService;
