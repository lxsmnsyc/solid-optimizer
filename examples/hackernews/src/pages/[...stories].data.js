import { query } from "@solidjs/router";
import fetchAPI from "../lib/api";

const mapStories = {
  top: "news",
  new: "newest",
  show: "show",
  ask: "ask",
  job: "jobs"
};

export const getStories = query(
  (type, page) => fetchAPI(`${mapStories[type]}?page=${page}`),
  "stories"
);

export default ({ location, params }) =>
  getStories(params.stories || "top", +(location.query.page || 1));
