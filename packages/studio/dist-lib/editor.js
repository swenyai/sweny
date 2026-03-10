import { c as me, u as Oe } from "./StandaloneViewer-Cvxlm5xF.js";
import { R as ct } from "./StandaloneViewer-Cvxlm5xF.js";
import Te from "react";
import { triageDefinition as xe } from "@sweny-ai/engine";
const ve = {},
  { useDebugValue: De } = Te,
  { useSyncExternalStoreWithSelector: Fe } = Oe;
let ce = !1;
const pe = (e) => e;
function Ae(e, t = pe, r) {
  (ve ? "production" : void 0) !== "production" &&
    r &&
    !ce &&
    (console.warn(
      "[DEPRECATED] Use `createWithEqualityFn` instead of `create` or use `useStoreWithEqualityFn` instead of `useStore`. They can be imported from 'zustand/traditional'. https://github.com/pmndrs/zustand/discussions/1937",
    ),
    (ce = !0));
  const n = Fe(e.subscribe, e.getState, e.getServerState || e.getInitialState, t, r);
  return (De(n), n);
}
const Me = (e) => {
    (ve ? "production" : void 0) !== "production" &&
      typeof e != "function" &&
      console.warn(
        "[DEPRECATED] Passing a vanilla store will be unsupported in a future version. Instead use `import { useStore } from 'zustand'`.",
      );
    const t = typeof e == "function" ? me(e) : e,
      r = (n, i) => Ae(t, n, i);
    return (Object.assign(r, t), r);
  },
  Ne = (e) => Me;
var fe = (e, t, r) => (i, a) => ({
    pastStates: (r == null ? void 0 : r.pastStates) || [],
    futureStates: (r == null ? void 0 : r.futureStates) || [],
    undo: (c = 1) => {
      var f, u;
      if (a().pastStates.length) {
        const s = ((f = r == null ? void 0 : r.partialize) == null ? void 0 : f.call(r, t())) || t(),
          l = a().pastStates.splice(-c, c),
          o = l.shift();
        (e(o),
          i({
            pastStates: a().pastStates,
            futureStates: a().futureStates.concat(
              ((u = r == null ? void 0 : r.diff) == null ? void 0 : u.call(r, s, o)) || s,
              l.reverse(),
            ),
          }));
      }
    },
    redo: (c = 1) => {
      var f, u;
      if (a().futureStates.length) {
        const s = ((f = r == null ? void 0 : r.partialize) == null ? void 0 : f.call(r, t())) || t(),
          l = a().futureStates.splice(-c, c),
          o = l.shift();
        (e(o),
          i({
            pastStates: a().pastStates.concat(
              ((u = r == null ? void 0 : r.diff) == null ? void 0 : u.call(r, s, o)) || s,
              l.reverse(),
            ),
            futureStates: a().futureStates,
          }));
      }
    },
    clear: () => i({ pastStates: [], futureStates: [] }),
    isTracking: !0,
    pause: () => i({ isTracking: !1 }),
    resume: () => i({ isTracking: !0 }),
    setOnSave: (c) => i({ _onSave: c }),
    // Internal properties
    _onSave: r == null ? void 0 : r.onSave,
    _handleSet: (c, f, u, s) => {
      var l, o;
      (r != null && r.limit && a().pastStates.length >= (r == null ? void 0 : r.limit) && a().pastStates.shift(),
        (o = (l = a())._onSave) == null || o.call(l, c, u),
        i({
          pastStates: a().pastStates.concat(s || c),
          futureStates: [],
        }));
    },
  }),
  Re = (e, t) => (n, i, a) => {
    var s, l;
    a.temporal = me(
      ((s = t == null ? void 0 : t.wrapTemporal) == null ? void 0 : s.call(t, fe(n, i, t))) || fe(n, i, t),
    );
    const c =
        ((l = t == null ? void 0 : t.handleSet) == null ? void 0 : l.call(t, a.temporal.getState()._handleSet)) ||
        a.temporal.getState()._handleSet,
      f = (o) => {
        var ne, ie, ae;
        if (!a.temporal.getState().isTracking) return;
        const g = ((ne = t == null ? void 0 : t.partialize) == null ? void 0 : ne.call(t, i())) || i(),
          v = (ie = t == null ? void 0 : t.diff) == null ? void 0 : ie.call(t, o, g);
        // If the user has provided a diff function but nothing has been changed, deltaState will be null
        v === null || // If the user has provided an equality function, use it
          ((ae = t == null ? void 0 : t.equality) != null && ae.call(t, o, g)) ||
          c(o, void 0, g, v);
      },
      u = a.setState;
    return (
      (a.setState = (...o) => {
        var v;
        const g = ((v = t == null ? void 0 : t.partialize) == null ? void 0 : v.call(t, i())) || i();
        (u(...o), f(g));
      }),
      e(
        // Modify the set function to call the userlandSet function
        (...o) => {
          var v;
          const g = ((v = t == null ? void 0 : t.partialize) == null ? void 0 : v.call(t, i())) || i();
          (n(...o), f(g));
        },
        i,
        a,
      )
    );
  },
  Pe = Symbol.for("immer-nothing"),
  ue = Symbol.for("immer-draftable"),
  _ = Symbol.for("immer-state"),
  Le =
    process.env.NODE_ENV !== "production"
      ? [
          // All error codes, starting by 0:
          function (e) {
            return `The plugin for '${e}' has not been loaded into Immer. To enable the plugin, import and call \`enable${e}()\` when initializing your application.`;
          },
          function (e) {
            return `produce can only be called on things that are draftable: plain objects, arrays, Map, Set or classes that are marked with '[immerable]: true'. Got '${e}'`;
          },
          "This object has been frozen and should not be mutated",
          function (e) {
            return (
              "Cannot use a proxy that has been revoked. Did you pass an object from inside an immer function to an async process? " +
              e
            );
          },
          "An immer producer returned a new value *and* modified its draft. Either return a new value *or* modify the draft.",
          "Immer forbids circular references",
          "The first or second argument to `produce` must be a function",
          "The third argument to `produce` must be a function or undefined",
          "First argument to `createDraft` must be a plain object, an array, or an immerable object",
          "First argument to `finishDraft` must be a draft returned by `createDraft`",
          function (e) {
            return `'current' expects a draft, got: ${e}`;
          },
          "Object.defineProperty() cannot be used on an Immer draft",
          "Object.setPrototypeOf() cannot be used on an Immer draft",
          "Immer only supports deleting array indices",
          "Immer only supports setting array indices and the 'length' property",
          function (e) {
            return `'original' expects a draft, got: ${e}`;
          },
          // Note: if more errors are added, the errorOffset in Patches.ts should be increased
          // See Patches.ts for additional errors
        ]
      : [];
function y(e, ...t) {
  if (process.env.NODE_ENV !== "production") {
    const r = Le[e],
      n = z(r) ? r.apply(null, t) : r;
    throw new Error(`[Immer] ${n}`);
  }
  throw new Error(`[Immer] minified error nr: ${e}. Full error at: https://bit.ly/3cXEKWf`);
}
var S = Object,
  I = S.getPrototypeOf,
  D = "constructor",
  R = "prototype",
  H = "configurable",
  F = "enumerable",
  T = "writable",
  w = "value",
  P = (e) => !!e && !!e[_];
function m(e) {
  var t;
  return e ? ge(e) || V(e) || !!e[ue] || !!((t = e[D]) != null && t[ue]) || U(e) || W(e) : !1;
}
var Ve = S[R][D].toString(),
  se = /* @__PURE__ */ new WeakMap();
function ge(e) {
  if (!e || !ee(e)) return !1;
  const t = I(e);
  if (t === null || t === S[R]) return !0;
  const r = S.hasOwnProperty.call(t, D) && t[D];
  if (r === Object) return !0;
  if (!z(r)) return !1;
  let n = se.get(r);
  return (n === void 0 && ((n = Function.toString.call(r)), se.set(r, n)), n === Ve);
}
function L(e, t, r = !0) {
  k(e) === 0
    ? (r ? Reflect.ownKeys(e) : S.keys(e)).forEach((i) => {
        t(i, e[i], e);
      })
    : e.forEach((n, i) => t(i, n, e));
}
function k(e) {
  const t = e[_];
  return t ? t.type_ : V(e) ? 1 : U(e) ? 2 : W(e) ? 3 : 0;
}
var le = (e, t, r = k(e)) => (r === 2 ? e.has(t) : S[R].hasOwnProperty.call(e, t)),
  K = (e, t, r = k(e)) =>
    // @ts-ignore
    r === 2 ? e.get(t) : e[t],
  p = (e, t, r, n = k(e)) => {
    n === 2 ? e.set(t, r) : n === 3 ? e.add(r) : (e[t] = r);
  };
function Ue(e, t) {
  return e === t ? e !== 0 || 1 / e === 1 / t : e !== e && t !== t;
}
var V = Array.isArray,
  U = (e) => e instanceof Map,
  W = (e) => e instanceof Set,
  ee = (e) => typeof e == "object",
  z = (e) => typeof e == "function",
  B = (e) => typeof e == "boolean";
function We(e) {
  const t = +e;
  return Number.isInteger(t) && String(t) === e;
}
var h = (e) => e.copy_ || e.base_,
  te = (e) => (e.modified_ ? e.copy_ : e.base_);
function Y(e, t) {
  if (U(e)) return new Map(e);
  if (W(e)) return new Set(e);
  if (V(e)) return Array[R].slice.call(e);
  const r = ge(e);
  if (t === !0 || (t === "class_only" && !r)) {
    const n = S.getOwnPropertyDescriptors(e);
    delete n[_];
    let i = Reflect.ownKeys(n);
    for (let a = 0; a < i.length; a++) {
      const c = i[a],
        f = n[c];
      (f[T] === !1 && ((f[T] = !0), (f[H] = !0)),
        (f.get || f.set) &&
          (n[c] = {
            [H]: !0,
            [T]: !0,
            // could live with !!desc.set as well here...
            [F]: f[F],
            [w]: e[c],
          }));
    }
    return S.create(I(e), n);
  } else {
    const n = I(e);
    if (n !== null && r) return { ...e };
    const i = S.create(n);
    return S.assign(i, e);
  }
}
function re(e, t = !1) {
  return (
    $(e) ||
      P(e) ||
      !m(e) ||
      (k(e) > 1 &&
        S.defineProperties(e, {
          set: O,
          add: O,
          clear: O,
          delete: O,
        }),
      S.freeze(e),
      t &&
        L(
          e,
          (r, n) => {
            re(n, !0);
          },
          !1,
        )),
    e
  );
}
function $e() {
  y(2);
}
var O = {
  [w]: $e,
};
function $(e) {
  return e === null || !ee(e) ? !0 : S.isFrozen(e);
}
var A = "MapSet",
  X = "Patches",
  oe = "ArrayMethods",
  ze = {};
function b(e) {
  const t = ze[e];
  return (t || y(0, e), t);
}
var de = (e) => !!ze[e],
  E,
  be = () => E,
  je = (e, t) => ({
    drafts_: [],
    parent_: e,
    immer_: t,
    // Whenever the modified draft contains a draft from another scope, we
    // need to prevent auto-freezing so the unowned draft can be finalized.
    canAutoFreeze_: !0,
    unfinalizedDrafts_: 0,
    handledSet_: /* @__PURE__ */ new Set(),
    processedForPatches_: /* @__PURE__ */ new Set(),
    mapSetPlugin_: de(A) ? b(A) : void 0,
    arrayMethodsPlugin_: de(oe) ? b(oe) : void 0,
  });
function _e(e, t) {
  t && ((e.patchPlugin_ = b(X)), (e.patches_ = []), (e.inversePatches_ = []), (e.patchListener_ = t));
}
function G(e) {
  (J(e), e.drafts_.forEach(Be), (e.drafts_ = null));
}
function J(e) {
  e === E && (E = e.parent_);
}
var ye = (e) => (E = je(E, e));
function Be(e) {
  const t = e[_];
  t.type_ === 0 || t.type_ === 1 ? t.revoke_() : (t.revoked_ = !0);
}
function Se(e, t) {
  t.unfinalizedDrafts_ = t.drafts_.length;
  const r = t.drafts_[0];
  if (e !== void 0 && e !== r) {
    (r[_].modified_ && (G(t), y(4)), m(e) && (e = he(t, e)));
    const { patchPlugin_: i } = t;
    i && i.generateReplacementPatches_(r[_].base_, e, t);
  } else e = he(t, r);
  return (qe(t, e, !0), G(t), t.patches_ && t.patchListener_(t.patches_, t.inversePatches_), e !== Pe ? e : void 0);
}
function he(e, t) {
  if ($(t)) return t;
  const r = t[_];
  if (!r) return M(t, e.handledSet_, e);
  if (!j(r, e)) return t;
  if (!r.modified_) return r.base_;
  if (!r.finalized_) {
    const { callbacks_: n } = r;
    if (n) for (; n.length > 0; ) n.pop()(e);
    Ee(r, e);
  }
  return r.copy_;
}
function qe(e, t, r = !1) {
  !e.parent_ && e.immer_.autoFreeze_ && e.canAutoFreeze_ && re(t, r);
}
function Ie(e) {
  ((e.finalized_ = !0), e.scope_.unfinalizedDrafts_--);
}
var j = (e, t) => e.scope_ === t,
  He = [];
function we(e, t, r, n) {
  const i = h(e),
    a = e.type_;
  if (n !== void 0 && K(i, n, a) === t) {
    p(i, n, r, a);
    return;
  }
  if (!e.draftLocations_) {
    const f = (e.draftLocations_ = /* @__PURE__ */ new Map());
    L(i, (u, s) => {
      if (P(s)) {
        const l = f.get(s) || [];
        (l.push(u), f.set(s, l));
      }
    });
  }
  const c = e.draftLocations_.get(t) ?? He;
  for (const f of c) p(i, f, r, a);
}
function Ke(e, t, r) {
  e.callbacks_.push(function (i) {
    var f;
    const a = t;
    if (!a || !j(a, i)) return;
    (f = i.mapSetPlugin_) == null || f.fixSetContents(a);
    const c = te(a);
    (we(e, a.draft_ ?? a, c, r), Ee(a, i));
  });
}
function Ee(e, t) {
  var n;
  if (
    e.modified_ &&
    !e.finalized_ &&
    (e.type_ === 3 ||
      (e.type_ === 1 && e.allIndicesReassigned_) ||
      (((n = e.assigned_) == null ? void 0 : n.size) ?? 0) > 0)
  ) {
    const { patchPlugin_: i } = t;
    if (i) {
      const a = i.getPath(e);
      a && i.generatePatches_(e, a, t);
    }
    Ie(e);
  }
}
function Ye(e, t, r) {
  const { scope_: n } = e;
  if (P(r)) {
    const i = r[_];
    j(i, n) &&
      i.callbacks_.push(function () {
        x(e);
        const c = te(i);
        we(e, r, c, t);
      });
  } else
    m(r) &&
      e.callbacks_.push(function () {
        const a = h(e);
        e.type_ === 3
          ? a.has(r) && M(r, n.handledSet_, n)
          : K(a, t, e.type_) === r &&
            n.drafts_.length > 1 &&
            (e.assigned_.get(t) ?? !1) === !0 &&
            e.copy_ &&
            M(K(e.copy_, t, e.type_), n.handledSet_, n);
      });
}
function M(e, t, r) {
  return (
    (!r.immer_.autoFreeze_ && r.unfinalizedDrafts_ < 1) ||
      P(e) ||
      t.has(e) ||
      !m(e) ||
      $(e) ||
      (t.add(e),
      L(e, (n, i) => {
        if (P(i)) {
          const a = i[_];
          if (j(a, r)) {
            const c = te(a);
            (p(e, n, c, e.type_), Ie(a));
          }
        } else m(i) && M(i, t, r);
      })),
    e
  );
}
function Xe(e, t) {
  const r = V(e),
    n = {
      type_: r ? 1 : 0,
      // Track which produce call this is associated with.
      scope_: t ? t.scope_ : be(),
      // True for both shallow and deep changes.
      modified_: !1,
      // Used during finalization.
      finalized_: !1,
      // Track which properties have been assigned (true) or deleted (false).
      // actually instantiated in `prepareCopy()`
      assigned_: void 0,
      // The parent draft state.
      parent_: t,
      // The base state.
      base_: e,
      // The base proxy.
      draft_: null,
      // set below
      // The base copy with any updated values.
      copy_: null,
      // Called by the `produce` function.
      revoke_: null,
      isManual_: !1,
      // `callbacks` actually gets assigned in `createProxy`
      callbacks_: void 0,
    };
  let i = n,
    a = N;
  r && ((i = [n]), (a = C));
  const { revoke: c, proxy: f } = Proxy.revocable(i, a);
  return ((n.draft_ = f), (n.revoke_ = c), [f, n]);
}
var N = {
    get(e, t) {
      if (t === _) return e;
      let r = e.scope_.arrayMethodsPlugin_;
      const n = e.type_ === 1 && typeof t == "string";
      if (n && r != null && r.isArrayOperationMethod(t)) return r.createMethodInterceptor(e, t);
      const i = h(e);
      if (!le(i, t, e.type_)) return Ge(e, i, t);
      const a = i[t];
      if (
        e.finalized_ ||
        !m(a) ||
        (n && e.operationMethod && r != null && r.isMutatingArrayMethod(e.operationMethod) && We(t))
      )
        return a;
      if (a === q(e.base_, t)) {
        x(e);
        const c = e.type_ === 1 ? +t : t,
          f = Z(e.scope_, a, e, c);
        return (e.copy_[c] = f);
      }
      return a;
    },
    has(e, t) {
      return t in h(e);
    },
    ownKeys(e) {
      return Reflect.ownKeys(h(e));
    },
    set(e, t, r) {
      const n = Ce(h(e), t);
      if (n != null && n.set) return (n.set.call(e.draft_, r), !0);
      if (!e.modified_) {
        const i = q(h(e), t),
          a = i == null ? void 0 : i[_];
        if (a && a.base_ === r) return ((e.copy_[t] = r), e.assigned_.set(t, !1), !0);
        if (Ue(r, i) && (r !== void 0 || le(e.base_, t, e.type_))) return !0;
        (x(e), Q(e));
      }
      return (
        (e.copy_[t] === r && // special case: handle new props with value 'undefined'
          (r !== void 0 || t in e.copy_)) || // special case: NaN
          (Number.isNaN(r) && Number.isNaN(e.copy_[t])) ||
          ((e.copy_[t] = r), e.assigned_.set(t, !0), Ye(e, t, r)),
        !0
      );
    },
    deleteProperty(e, t) {
      return (
        x(e),
        q(e.base_, t) !== void 0 || t in e.base_ ? (e.assigned_.set(t, !1), Q(e)) : e.assigned_.delete(t),
        e.copy_ && delete e.copy_[t],
        !0
      );
    },
    // Note: We never coerce `desc.value` into an Immer draft, because we can't make
    // the same guarantee in ES5 mode.
    getOwnPropertyDescriptor(e, t) {
      const r = h(e),
        n = Reflect.getOwnPropertyDescriptor(r, t);
      return (
        n && {
          [T]: !0,
          [H]: e.type_ !== 1 || t !== "length",
          [F]: n[F],
          [w]: r[t],
        }
      );
    },
    defineProperty() {
      y(11);
    },
    getPrototypeOf(e) {
      return I(e.base_);
    },
    setPrototypeOf() {
      y(12);
    },
  },
  C = {};
for (let e in N) {
  let t = N[e];
  C[e] = function () {
    const r = arguments;
    return ((r[0] = r[0][0]), t.apply(this, r));
  };
}
C.deleteProperty = function (e, t) {
  return (process.env.NODE_ENV !== "production" && isNaN(parseInt(t)) && y(13), C.set.call(this, e, t, void 0));
};
C.set = function (e, t, r) {
  return (
    process.env.NODE_ENV !== "production" && t !== "length" && isNaN(parseInt(t)) && y(14),
    N.set.call(this, e[0], t, r, e[0])
  );
};
function q(e, t) {
  const r = e[_];
  return (r ? h(r) : e)[t];
}
function Ge(e, t, r) {
  var i;
  const n = Ce(t, r);
  return n
    ? w in n
      ? n[w]
      : // This is a very special case, if the prop is a getter defined by the
        // prototype, we should invoke it with the draft as context!
        (i = n.get) == null
        ? void 0
        : i.call(e.draft_)
    : void 0;
}
function Ce(e, t) {
  if (!(t in e)) return;
  let r = I(e);
  for (; r; ) {
    const n = Object.getOwnPropertyDescriptor(r, t);
    if (n) return n;
    r = I(r);
  }
}
function Q(e) {
  e.modified_ || ((e.modified_ = !0), e.parent_ && Q(e.parent_));
}
function x(e) {
  e.copy_ || ((e.assigned_ = /* @__PURE__ */ new Map()), (e.copy_ = Y(e.base_, e.scope_.immer_.useStrictShallowCopy_)));
}
var Je = class {
  constructor(e) {
    ((this.autoFreeze_ = !0),
      (this.useStrictShallowCopy_ = !1),
      (this.useStrictIteration_ = !1),
      (this.produce = (t, r, n) => {
        if (z(t) && !z(r)) {
          const a = r;
          r = t;
          const c = this;
          return function (u = a, ...s) {
            return c.produce(u, (l) => r.call(this, l, ...s));
          };
        }
        (z(r) || y(6), n !== void 0 && !z(n) && y(7));
        let i;
        if (m(t)) {
          const a = ye(this),
            c = Z(a, t, void 0);
          let f = !0;
          try {
            ((i = r(c)), (f = !1));
          } finally {
            f ? G(a) : J(a);
          }
          return (_e(a, n), Se(i, a));
        } else if (!t || !ee(t)) {
          if (((i = r(t)), i === void 0 && (i = t), i === Pe && (i = void 0), this.autoFreeze_ && re(i, !0), n)) {
            const a = [],
              c = [];
            (b(X).generateReplacementPatches_(t, i, {
              patches_: a,
              inversePatches_: c,
            }),
              n(a, c));
          }
          return i;
        } else y(1, t);
      }),
      (this.produceWithPatches = (t, r) => {
        if (z(t)) return (c, ...f) => this.produceWithPatches(c, (u) => t(u, ...f));
        let n, i;
        return [
          this.produce(t, r, (c, f) => {
            ((n = c), (i = f));
          }),
          n,
          i,
        ];
      }),
      B(e == null ? void 0 : e.autoFreeze) && this.setAutoFreeze(e.autoFreeze),
      B(e == null ? void 0 : e.useStrictShallowCopy) && this.setUseStrictShallowCopy(e.useStrictShallowCopy),
      B(e == null ? void 0 : e.useStrictIteration) && this.setUseStrictIteration(e.useStrictIteration));
  }
  createDraft(e) {
    (m(e) || y(8), P(e) && (e = Qe(e)));
    const t = ye(this),
      r = Z(t, e, void 0);
    return ((r[_].isManual_ = !0), J(t), r);
  }
  finishDraft(e, t) {
    const r = e && e[_];
    (!r || !r.isManual_) && y(9);
    const { scope_: n } = r;
    return (_e(n, t), Se(void 0, n));
  }
  /**
   * Pass true to automatically freeze all copies created by Immer.
   *
   * By default, auto-freezing is enabled.
   */
  setAutoFreeze(e) {
    this.autoFreeze_ = e;
  }
  /**
   * Pass true to enable strict shallow copy.
   *
   * By default, immer does not copy the object descriptors such as getter, setter and non-enumrable properties.
   */
  setUseStrictShallowCopy(e) {
    this.useStrictShallowCopy_ = e;
  }
  /**
   * Pass false to use faster iteration that skips non-enumerable properties
   * but still handles symbols for compatibility.
   *
   * By default, strict iteration is enabled (includes all own properties).
   */
  setUseStrictIteration(e) {
    this.useStrictIteration_ = e;
  }
  shouldUseStrictIteration() {
    return this.useStrictIteration_;
  }
  applyPatches(e, t) {
    let r;
    for (r = t.length - 1; r >= 0; r--) {
      const i = t[r];
      if (i.path.length === 0 && i.op === "replace") {
        e = i.value;
        break;
      }
    }
    r > -1 && (t = t.slice(r + 1));
    const n = b(X).applyPatches_;
    return P(e) ? n(e, t) : this.produce(e, (i) => n(i, t));
  }
};
function Z(e, t, r, n) {
  const [i, a] = U(t) ? b(A).proxyMap_(t, r) : W(t) ? b(A).proxySet_(t, r) : Xe(t, r);
  return (
    ((r == null ? void 0 : r.scope_) ?? be()).drafts_.push(i),
    (a.callbacks_ = (r == null ? void 0 : r.callbacks_) ?? []),
    (a.key_ = n),
    r && n !== void 0
      ? Ke(r, a, n)
      : a.callbacks_.push(function (u) {
          var l;
          (l = u.mapSetPlugin_) == null || l.fixSetContents(a);
          const { patchPlugin_: s } = u;
          a.modified_ && s && s.generatePatches_(a, [], u);
        }),
    i
  );
}
function Qe(e) {
  return (P(e) || y(10, e), ke(e));
}
function ke(e) {
  if (!m(e) || $(e)) return e;
  const t = e[_];
  let r,
    n = !0;
  if (t) {
    if (!t.modified_) return t.base_;
    ((t.finalized_ = !0),
      (r = Y(e, t.scope_.immer_.useStrictShallowCopy_)),
      (n = t.scope_.immer_.shouldUseStrictIteration()));
  } else r = Y(e, !0);
  return (
    L(
      r,
      (i, a) => {
        p(r, i, ke(a));
      },
      n,
    ),
    t && (t.finalized_ = !1),
    r
  );
}
var Ze = new Je(),
  d = Ze.produce;
const nt = Ne()(
  Re(
    (e, t) => ({
      definition: xe,
      selection: null,
      isLayoutStale: !1,
      // ExecutionSlice initial state
      mode: "design",
      currentStateId: null,
      completedStates: {},
      executionStatus: "idle",
      liveConnection: null,
      setMode: (r) =>
        e(
          d((n) => {
            n.mode = r;
          }),
        ),
      applyEvent: (r) =>
        e(
          d((n) => {
            (r.type === "recipe:start" &&
              ((n.currentStateId = null), (n.completedStates = {}), (n.executionStatus = "running")),
              r.type === "state:enter" && (n.currentStateId = r.stateId),
              r.type === "state:exit" && ((n.currentStateId = null), (n.completedStates[r.stateId] = r.result)),
              r.type === "recipe:end" && ((n.currentStateId = null), (n.executionStatus = r.status)));
          }),
        ),
      resetExecution: () =>
        e(
          d((r) => {
            ((r.currentStateId = null),
              (r.completedStates = {}),
              (r.executionStatus = "idle"),
              (r.liveConnection = null));
          }),
        ),
      setLiveConnection: (r) =>
        e(
          d((n) => {
            n.liveConnection = r;
          }),
        ),
      setDefinition: (r) =>
        e(
          d((n) => {
            ((n.definition = r), (n.isLayoutStale = !0));
          }),
        ),
      setSelection: (r) =>
        e(
          d((n) => {
            n.selection = r;
          }),
        ),
      markLayoutFresh: () =>
        e(
          d((r) => {
            r.isLayoutStale = !1;
          }),
        ),
      updateRecipeMeta: (r) =>
        e(
          d((n) => {
            (r.name !== void 0 && (n.definition.name = r.name),
              r.description !== void 0 && (n.definition.description = r.description),
              r.version !== void 0 && (n.definition.version = r.version));
          }),
        ),
      addState: (r, n) =>
        e(
          d((i) => {
            !r || i.definition.states[r] || ((i.definition.states[r] = { phase: n }), (i.isLayoutStale = !0));
          }),
        ),
      deleteState: (r) =>
        e(
          d((n) => {
            var i;
            delete n.definition.states[r];
            for (const a of Object.values(n.definition.states))
              if ((a.next === r && delete a.next, a.on)) {
                for (const c of Object.keys(a.on)) a.on[c] === r && delete a.on[c];
                Object.keys(a.on).length === 0 && delete a.on;
              }
            if (n.definition.initial === r) {
              const a = Object.keys(n.definition.states);
              n.definition.initial = a[0] ?? "";
            }
            (((i = n.selection) == null ? void 0 : i.kind) === "state" && n.selection.id === r && (n.selection = null),
              (n.isLayoutStale = !0));
          }),
        ),
      updateState: (r, n) =>
        e(
          d((i) => {
            const a = i.definition.states[r];
            if (!a) return;
            const c = n.next !== void 0 || n.on !== void 0;
            (n.phase !== void 0 && (a.phase = n.phase),
              n.description !== void 0 && (a.description = n.description),
              n.critical !== void 0 && (a.critical = n.critical),
              n.next !== void 0 && (a.next = n.next),
              n.on !== void 0 && (a.on = n.on),
              c && (i.isLayoutStale = !0));
          }),
        ),
      setInitial: (r) =>
        e(
          d((n) => {
            n.definition.initial = r;
          }),
        ),
      addTransition: (r, n, i) =>
        e(
          d((a) => {
            const c = a.definition.states[r];
            c && (n === "→" ? (c.next = i) : (c.on || (c.on = {}), (c.on[n] = i)), (a.isLayoutStale = !0));
          }),
        ),
      updateTransitionOutcome: (r, n, i) =>
        e(
          d((a) => {
            var u;
            const c = a.definition.states[r];
            if (!c) return;
            let f;
            (n === "→"
              ? ((f = c.next), delete c.next)
              : ((f = (u = c.on) == null ? void 0 : u[n]), c.on && delete c.on[n]),
              f !== void 0 &&
                (i === "→"
                  ? ((c.next = f), c.on && Object.keys(c.on).length === 0 && delete c.on)
                  : (c.on || (c.on = {}), (c.on[i] = f))));
          }),
        ),
      updateTransitionTarget: (r, n, i) =>
        e(
          d((a) => {
            const c = a.definition.states[r];
            c && (n === "→" ? (c.next = i) : c.on && (c.on[n] = i));
          }),
        ),
      deleteTransition: (r, n) =>
        e(
          d((i) => {
            const a = i.definition.states[r];
            a &&
              (n === "→" ? delete a.next : a.on && (delete a.on[n], Object.keys(a.on).length === 0 && delete a.on),
              (i.isLayoutStale = !0));
          }),
        ),
    }),
    {
      // Only track `definition` in undo history — not selection or isLayoutStale
      partialize: (e) => ({ definition: e.definition }),
    },
  ),
);
export { ct as StandaloneViewer, nt as useEditorStore };
