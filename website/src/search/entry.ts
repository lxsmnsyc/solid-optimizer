// The shape of one search entry. The build writes them and the command bar reads them.

export interface Entry {
  /** The address of the page, relative to the base: `docs/effects/`. */
  page: string;
  pageTitle: string;
  /** The heading, or an empty string for the entry of the page itself. */
  heading: string;
  /** The id of the heading, or an empty string for the entry of the page itself. */
  id: string;
  /** The text of the section, with the markup removed. */
  text: string;
}
