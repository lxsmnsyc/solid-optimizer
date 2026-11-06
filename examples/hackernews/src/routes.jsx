import { Loading, lazy } from "solid-js";
import { createRouter } from "@solidjs/router";
import Nav from "./components/nav";
import StoriesData from "./pages/[...stories].data";
import StoryData from "./pages/stories/[id].data";
import UserData from "./pages/users/[id].data";

export const Router = createRouter({
  routes: [
    {
      component: (props) => (
        <>
          <Nav />
          <Loading>{props.children}</Loading>
        </>
      ),
      children: [
        {
          path: "/users/:id",
          component: lazy(() => import("./pages/users/[id]")),
          preload: UserData
        },
        {
          path: "/stories/:id",
          component: lazy(() => import("./pages/stories/[id]")),
          preload: StoryData
        },
        {
          path: "/*stories",
          component: lazy(() => import("./pages/[...stories]")),
          preload: StoriesData
        }
      ]
    }
  ]
});
