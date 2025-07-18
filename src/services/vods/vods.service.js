// Initializes the `vods` service on path `/vods`
const { Vods } = require("./vods.class");
const createModel = require("../../models/vods.model");
const hooks = require("./vods.hooks");
const { limiter } = require("../../middleware/rateLimit");

module.exports = function (app) {
  const options = {
    Model: createModel(app),
    paginate: app.get("paginate"),
    multi: true
  };

  // Initialize our service with any options it requires
  app.use("/vods", limiter(app), new Vods(options, app));

  // Get our initialized service so that we can register hooks
  const service = app.service("vods");

  service.hooks(hooks);
};
