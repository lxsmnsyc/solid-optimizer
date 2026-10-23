import { query } from "@solidjs/router";
import fetchAPI from "../../lib/api";

export const getUser = query((id) => fetchAPI(`user/${id}`), "user");

export default ({ params }) => getUser(params.id);
