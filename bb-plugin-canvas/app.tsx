// bb-plugin-canvas — frontend entry: the "Canvas" nav page (BBP-189).
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { CANVAS_ICON, CanvasTree } from "./components/canvas-icon";
import { CanvasPage } from "./components/canvas-page";

export default definePluginApp((app) => {
  app.experimental_icons.register({ name: CANVAS_ICON, component: CanvasTree });
  app.slots.navPanel({
    id: "canvas",
    title: "Canvas",
    icon: CANVAS_ICON,
    path: "canvas",
    component: CanvasPage,
  });
});
