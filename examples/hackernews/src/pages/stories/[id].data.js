import { query } from "@solidjs/router";
import fetchAPI from "../../lib/api";

export const getStory = query((id) => fetchAPI(`item/${id}`), "story");

export default ({ params }) => getStory(params.id);
