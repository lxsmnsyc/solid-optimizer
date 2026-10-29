var _tmpl$ = /* @__PURE__ */ template(`<h1>User : `);
var _tmpl$2 = /* @__PURE__ */ template(`<li class=about>`);
var _tmpl$3 = /* @__PURE__ */ template(`<ul class=meta><li><span class=label>Created:</span> </li><li><span class=label>Karma:</span> `);
var _tmpl$4 = /* @__PURE__ */ template(`<p class=links><a>submissions</a> | <a>comments`);
var _tmpl$5 = /* @__PURE__ */ template(`<div class=user-view>`);
var _tmpl$6 = /* @__PURE__ */ template(`<h1>User not found.`);
import { $ as getOwner, B as Show, F as setAttribute, H as createMemo, L as template, O as effect, T as claimElement, V as createComponent, j as insert } from "./api-Dp5JPr3g.js";
import { t as getUser } from "./index-Bc3EZT44.js";
//#region src/pages/users/[id].jsx
function User(props) {
	const user = createMemo(() => getUser(props.params.id));
	var _el$ = _tmpl$5();
	insert(_el$, createComponent(Show, {
		get when() {
			return user();
		},
		get children() {
			return createComponent(Show, {
				get when() {
					return !user().error;
				},
				get fallback() {
					return _tmpl$6();
				},
				get children() {
					return [
						(() => {
							var _el$2 = _tmpl$();
							_el$2.firstChild;
							insert(_el$2, () => {
								return user().id;
							}, null);
							return _el$2;
						})(),
						(() => {
							var _el$4 = _tmpl$3();
							var _el$5 = _el$4.firstChild;
							_el$5.firstChild.nextSibling;
							var _el$8 = _el$5.nextSibling;
							_el$8.firstChild.nextSibling;
							insert(_el$5, () => {
								return user().created;
							}, null);
							insert(_el$8, () => {
								return user().karma;
							}, null);
							insert(_el$4, createComponent(Show, {
								get when() {
									return user().about;
								},
								get children() {
									return [(() => {
										var _el$11 = _tmpl$2();
										effect(() => user().about, (_v$) => {
											_el$11.innerHTML = _v$;
										});
										return _el$11;
									})(), " "];
								}
							}), null);
							return _el$4;
						})(),
						(() => {
							var _el$12 = _tmpl$4();
							var _el$13 = _el$12.firstChild;
							var _el$15 = _el$13.nextSibling.nextSibling;
							var _o$ = getOwner();
							effect(() => {
								return {
									e: `https://news.ycombinator.com/submitted?id=${user().id}`,
									t: `https://news.ycombinator.com/threads?id=${user().id}`
								};
							}, ({ e, t }, _p$) => {
								e !== _p$?.e && setAttribute(_el$13, "href", e);
								t !== _p$?.t && setAttribute(_el$15, "href", t);
								claimElement(_el$13, _o$);
								claimElement(_el$15, _o$);
							});
							return _el$12;
						})()
					];
				}
			});
		}
	}));
	return _el$;
}
//#endregion
export { User as default };
