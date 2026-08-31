process.env.BOT_TOKEN = "dummy:token";
const app = require("./server");

function listRoutes(stack, prefix) {
  const out = [];
  stack.forEach((layer) => {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).join(",").toUpperCase();
      out.push(`${methods} ${prefix}${layer.route.path}`);
    } else if (layer.name === "router" && layer.handle.stack) {
      out.push(...listRoutes(layer.handle.stack, prefix));
    }
  });
  return out;
}

const routes = listRoutes(app._router.stack, "");
console.log("Total routes:", routes.length);
routes.forEach((r) => console.log(r));
