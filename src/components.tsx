/*@refresh skip*/

import type { Component, JSX } from "solid-js";
import { createMemo, createRoot, mergeProps, on, Show, splitProps } from "solid-js";
import { isServer } from "solid-js/web";
import { pathIntegration, staticIntegration } from "./integration";
import {
  createBranches,
  createRouteContext,
  createRouterContext,
  getRouteMatches,
  RouteContextObj,
  RouterContextObj,
  useHref,
  useLocation,
  useNavigate,
  useResolvedPath,
  useRoute,
  useRouter
} from "./routing";
import type {
  Location,
  LocationChangeSignal,
  Navigator,
  RouteContext,
  RouteDataFunc,
  RouteDefinition,
  RouterIntegration
} from "./types";
import { joinPaths } from "./utils";

// declare module "solid-js" {
//   namespace JSX {
//     interface AnchorExtended extends AnchorHTMLAttributes<HTMLAnchorElement> {
//       state?: string;
//       noscroll?: boolean;
//       replace?: boolean;
//     }

//     interface IntrinsicElements {
//       a: AnchorExtended
//     }
//   }
// }

export type RouterProps = {
  base?: string;
  data?: RouteDataFunc;
  children: JSX.Element;
  out?: object;
} & (
  | {
      url?: never;
      source?: RouterIntegration | LocationChangeSignal;
    }
  | {
      source?: never;
      url: string;
    }
);

export const Router = (props: RouterProps) => {
  const { source, url, base, data, out } = props;
  const integration =
    source || (isServer ? staticIntegration({ value: url || "" }) : pathIntegration());
  const routerState = createRouterContext(integration, base, data, out);

  return (
    <RouterContextObj.Provider value={routerState}>{props.children}</RouterContextObj.Provider>
  );
};

export interface RoutesProps {
  base?: string;
  children: JSX.Element;
}

export const Routes = (props: RoutesProps) => {
  const router = useRouter();
  const parentRoute = useRoute();
  const branches = createMemo(() =>
    createBranches(
      props.children as unknown as RouteDefinition | RouteDefinition[],
      joinPaths(parentRoute.pattern, props.base || ""),
      Outlet
    )
  );
  const matches = createMemo(() => getRouteMatches(branches(), router.location.pathname));

  if (router.out) {
    router.out.matches.push(
      matches().map(({ route, path, params }) => ({
        originalPath: route.originalPath,
        pattern: route.pattern,
        path,
        params
      }))
    );
  }

  const disposers: (() => void)[] = [];
  let root: RouteContext | undefined;

  const routeStates = createMemo(
    on(matches, (nextMatches, prevMatches, prev: RouteContext[] | undefined) => {
      let equal = prevMatches && nextMatches.length === prevMatches.length;
      const next: RouteContext[] = [];
      for (let i = 0, len = nextMatches.length; i < len; i++) {
        const prevMatch = prevMatches && prevMatches[i];
        const nextMatch = nextMatches[i];

        if (prev && prevMatch && nextMatch.route.pattern === prevMatch.route.pattern) {
          next[i] = prev[i];
        } else {
          equal = false;
          if (disposers[i]) {
            disposers[i]();
          }

          createRoot(dispose => {
            disposers[i] = dispose;
            next[i] = createRouteContext(
              router,
              next[i - 1] || parentRoute,
              () => routeStates()[i + 1],
              () => matches()[i]
            );
          });
        }
      }

      disposers.splice(nextMatches.length).forEach(dispose => dispose());

      if (prev && equal) {
        return prev;
      }
      root = next[0];
      return next;
    })
  );

  return (
    <Show when={routeStates() && root}>
      {route => <RouteContextObj.Provider value={route}>{route.outlet()}</RouteContextObj.Provider>}
    </Show>
  );
};

export const useRoutes = (routes: RouteDefinition | RouteDefinition[], base?: string) => {
  return () => <Routes base={base}>{routes as any}</Routes>;
};

export type RouteProps = {
  path: string;
  children?: JSX.Element;
  data?: RouteDataFunc;
} & (
  | {
      element?: never;
      component: Component;
    }
  | {
      component?: never;
      element?: JSX.Element;
      preload?: () => void;
    }
);

export const Route = (props: RouteProps) => props as unknown as JSX.Element;

export const Outlet = () => {
  const route = useRoute();
  return (
    <Show when={route.child}>
      {child => <RouteContextObj.Provider value={child}>{child.outlet()}</RouteContextObj.Provider>}
    </Show>
  );
};

function serialize(obj: unknown): string | undefined {
  return obj !== undefined ? JSON.stringify(obj) : undefined;
}

interface LinkBaseProps extends JSX.AnchorHTMLAttributes<HTMLAnchorElement> {
  to: string | undefined;
  replace?: boolean;
  noScroll?: boolean;
  state?: unknown;
}

function LinkBase(props: LinkBaseProps) {
  const [, rest] = splitProps(props, ["children", "to", "href", "state", "onClick"]);
  const href = useHref(() => props.to);

  return (
    <a
      {...rest}
      href={href() || props.href}
      {...{
        state: serialize(props.state),
        noscroll: props.noScroll,
        replace: props.replace
      }}
      // state={serialize(props.state)}
      // noscroll={props.noScroll}
      // replace={props.replace}
    >
      {props.children}
    </a>
  );
}

export interface LinkProps extends JSX.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  replace?: boolean;
  noScroll?: boolean;
  state?: unknown;
}

export function Link(props: LinkProps) {
  const to = useResolvedPath(() => props.href);
  return <LinkBase {...props} to={to()} />;
}

export interface NavLinkProps extends LinkProps {
  inactiveClass?: string;
  activeClass?: string;
  end?: boolean;
}

export function NavLink(props: NavLinkProps) {
  props = mergeProps({ inactiveClass: "inactive", activeClass: "active" }, props);
  const [, rest] = splitProps(props, ["activeClass", "end"]);
  const location = useLocation();
  const to = useResolvedPath(() => props.href);
  const isActive = createMemo(() => {
    const to_ = to();
    if (to_ === undefined) {
      return false;
    }
    const path = to_.split(/[?#]/, 1)[0].toLowerCase();
    const loc = location.pathname.toLowerCase();
    return props.end ? path === loc : loc.startsWith(path);
  });

  return (
    <LinkBase
      {...rest}
      to={to()}
      classList={{ [props.inactiveClass!]: !isActive(), [props.activeClass!]: isActive() }}
      aria-current={isActive() ? "page" : undefined}
    />
  );
}

export interface NavigateProps {
  href: ((args: { navigate: Navigator; location: Location }) => string) | string;
  state?: unknown;
}

export function Navigate(props: NavigateProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { href, state } = props;
  const path = typeof href === "function" ? href({ navigate, location }) : href;
  navigate(path, { replace: true, state });
  return null;
}
