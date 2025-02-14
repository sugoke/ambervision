import { Meteor } from 'meteor/meteor';
import { Template } from 'meteor/templating';
import { ReactiveVar } from 'meteor/reactive-var';
import 'jquery';
import 'bootstrap';
import 'jquery-ui-dist/jquery-ui.min.css';

import '/imports/tabular-tables.js';
// Make Bootstrap globally available
window.bootstrap = require('bootstrap');

// Importing other required files
import './main.html';
import { Products } from '/imports/api/products/products.js';
import '/lib/router.js';
import moment from 'moment';

// Importing custom JS files
import './js/productDetails.js';
import './mainlayout.js';
import './js/login.js';
import './js/products.js';
import './js/editProduct.js';
import './js/templates/orion.js';

import './js/templates/phoenix.js';
import './js/templates/twinWin.js';
import './js/home.js';
import './js/admin.js';
import './js/profile.js';
import './js/templates/underlyingRow.js';

import 'chart.js';
import 'chartjs-adapter-date-fns';

// Importing custom HTML templates
import './mainlayout.html';
import './html/home.html';
import './html/products.html';
import './html/productDetails.html';
import './html/login.html';
import './html/editProduct.html';
import './html/templates/orion.html';
import './html/templates/phoenix.html';
import './html/templates/twinWin.html';
import './html/profile.html';
import './html/admin.html';
import PerfectScrollbar from 'perfect-scrollbar';

import './js/login.js';


Template.registerHelper('isSuperAdmin', function() {
  const user = Meteor.user();
  return user && user.role === 'superAdmin';
});


Template.registerHelper('formatDate', function(date) {
  return moment(date).format('DD/MM/YYYY');
});


Template.registerHelper('formatCurrency', function(amount, currencyObj) {
  if (typeof amount !== 'number') {
    return amount;
  }
  
  let currencyCode = 'USD'; // Default currency code

  if (typeof currencyObj === 'string') {
    currencyCode = currencyObj;
  } else if (currencyObj && typeof currencyObj === 'object' && currencyObj.currency) {
    currencyCode = currencyObj.currency;
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
});

// Add the new lt helper here
Template.registerHelper('lt', function(a, b) {
  return a < b;
});

Meteor.startup(() => {


  // Initialize Bootstrap components that require JavaScript
  const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
  const tooltipList = tooltipTriggerList.map(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl));

  const popoverTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="popover"]'));
  const popoverList = popoverTriggerList.map(popoverTriggerEl => new bootstrap.Popover(popoverTriggerEl));


  var app = {
      id: "#app",
      isMobile: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 992,
      bootstrap: {
        tooltip: {
          attr: 'data-bs-toggle="tooltip"'
        },
        popover: {
          attr: 'data-bs-toggle="popover"'
        },
        modal: {
          attr: 'data-bs-toggle="modal"',
          dismissAttr: 'data-bs-dismiss="modal"',
          event: {
            hidden: "hidden.bs.modal"
          }
        },
        nav: {
          class: "nav",
          tabs: {
            class: "nav-tabs",
            activeClass: "active",
            itemClass: "nav-item",
            itemLinkClass: "nav-link"
          }
        }
      },
      header: {
        id: "#header",
        class: "app-header",
        hasScrollClass: "has-scroll"
      },
      sidebar: {
        id: "#sidebar",
        class: "app-sidebar",
        scrollBar: {
          localStorage: "appSidebarScrollPosition",
          dom: ""
        },
        menu: {
          class: "menu",
          initAttr: "data-init",
          animationTime: 0,
          itemClass: "menu-item",
          itemLinkClass: "menu-link",
          hasSubClass: "has-sub",
          activeClass: "active",
          expandingClass: "expanding",
          expandClass: "expand",
          submenu: {
            class: "menu-submenu"
          }
        },
        mobile: {
          toggleAttr: 'data-toggle="app-sidebar-mobile"',
          dismissAttr: 'data-dismiss="app-sidebar-mobile"',
          toggledClass: "app-sidebar-mobile-toggled",
          closedClass: "app-sidebar-mobile-closed",
          backdrop: {
            class: "app-sidebar-mobile-backdrop"
          }
        },
        minify: {
          toggleAttr: 'data-toggle="app-sidebar-minify"',
          toggledClass: "app-sidebar-minified",
          cookieName: "app-sidebar-minified"
        },
        floatSubmenu: {
          id: "#app-sidebar-float-submenu",
          dom: "",
          timeout: "",
          class: "app-sidebar-float-submenu",
          container: {
            class: "app-sidebar-float-submenu-container"
          },
          arrow: {
            id: "#app-sidebar-float-submenu-arrow",
            class: "app-sidebar-float-submenu-arrow"
          },
          line: {
            id: "#app-sidebar-float-submenu-line",
            class: "app-sidebar-float-submenu-line"
          },
          overflow: {
            class: "overflow-scroll mh-100vh"
          }
        },
        search: {
          class: "menu-search",
          toggleAttr: 'data-sidebar-search="true"',
          hideClass: "d-none",
          foundClass: "has-text"
        },
        transparent: {
          class: "app-sidebar-transparent"
        }
      },
      topNav: {
        id: "#top-nav",
        class: "app-top-nav",
        mobile: {
          toggleAttr: 'data-toggle="app-top-nav-mobile"'
        },
        menu: {
          class: "menu",
          itemClass: "menu-item",
          itemLinkClass: "menu-link",
          activeClass: "active",
          hasSubClass: "has-sub",
          expandClass: "expand",
          submenu: {
            class: "menu-submenu"
          }
        },
        control: {
          class: "menu-control",
          startClass: "menu-control-start",
          endClass: "menu-control-end",
          showClass: "show",
          buttonPrev: {
            class: "menu-control-start",
            toggleAttr: 'data-toggle="app-top-menu-prev"'
          },
          buttonNext: {
            class: "menu-control-end",
            toggleAttr: 'data-toggle="app-top-menu-next"'
          }
        }
      },
      scrollBar: {
        attr: 'data-scrollbar="true"',
        skipMobileAttr: "data-skip-mobile",
        heightAttr: "data-height",
        wheelPropagationAttr: "data-wheel-propagation"
      },
      content: {
        id: "#content",
        class: "app-content",
        fullHeight: {
          class: "app-content-full-height"
        },
        fullWidth: {
          class: "app-content-full-width"
        }
      },
      layout: {
        sidebarLight: {
          class: "app-with-light-sidebar"
        },
        sidebarEnd: {
          class: "app-with-end-sidebar"
        },
        sidebarWide: {
          class: "app-with-wide-sidebar"
        },
        sidebarMinified: {
          class: "app-sidebar-minified"
        },
        sidebarTwo: {
          class: "app-with-two-sidebar"
        },
        withoutHeader: {
          class: "app-without-header"
        },
        withoutSidebar: {
          class: "app-without-sidebar"
        },
        topMenu: {
          class: "app-with-top-menu"
        },
        boxedLayout: {
          class: "boxed-layout"
        }
      },
      scrollToTopBtn: {
        showClass: "show",
        heightShow: 200,
        toggleAttr: 'data-toggle="scroll-to-top"',
        scrollSpeed: 500
      },
      scrollTo: {
        attr: 'data-toggle="scroll-to"',
        target: "data-target",
        linkTarget: "href"
      },
      dismissClass: {
        toggleAttr: "data-dismiss-class",
        targetAttr: "data-dismiss-target"
      },
      toggleClass: {
        toggleAttr: "data-toggle-class",
        targetAttr: "data-toggle-target"
      },
      variablePrefix: "bs-",
      variableFontList: ["body-font-family", "body-font-size", "body-font-weight", "body-line-height"],
      variableColorList: ["theme", "theme-rgb", "theme-color", "theme-color-rgb", "default", "default-rgb", "primary", "primary-rgb", "primary-bg-subtle", "primary-text", "primary-border-subtle", "secondary", "secondary-rgb", "secondary-bg-subtle", "secondary-text", "secondary-border-subtle", "success", "success-rgb", "success-bg-subtle", "success-text", "success-border-subtle", "warning", "warning-rgb", "warning-bg-subtle", "warning-text", "warning-border-subtle", "info", "info-rgb", "info-bg-subtle", "info-text", "info-border-subtle", "danger", "danger-rgb", "danger-bg-subtle", "danger-text", "danger-border-subtle", "light", "light-rgb", "light-bg-subtle", "light-text", "light-border-subtle", "dark", "dark-rgb", "dark-bg-subtle", "dark-text", "dark-border-subtle", "inverse", "inverse-rgb", "white", "white-rgb", "black", "black-rgb", "teal", "teal-rgb", "indigo", "indigo-rgb", "purple", "purple-rgb", "yellow", "yellow-rgb", "pink", "pink-rgb", "cyan", "cyan-rgb", "gray-100", "gray-200", "gray-300", "gray-400", "gray-500", "gray-600", "gray-700", "gray-800", "gray-900", "gray-100-rgb", "gray-200-rgb", "gray-300-rgb", "gray-400-rgb", "gray-500-rgb", "gray-600-rgb", "gray-700-rgb", "gray-800-rgb", "gray-900-rgb", "muted", "muted-rgb", "emphasis-color", "emphasis-color-rgb", "body-bg", "body-bg-rgb", "body-color", "body-color-rgb", "heading-color", "secondary-color", "secondary-color-rgb", "secondary-bg", "secondary-bg-rgb", "tertiary-color", "tertiary-color-rgb", "tertiary-bg", "tertiary-bg-rgb", "link-color", "link-color-rgb", "link-hover-color", "link-hover-color-rgb", "border-color", "border-color-translucent"],
      font: {},
      color: {},
      card: {
        expand: {
          status: !1,
          toggleAttr: 'data-toggle="card-expand"',
          toggleTitle: "Expand / Compress",
          class: "card-expand"
        }
      },
      init: {
        attr: "data-init",
        class: "app-init"
      },
      animation: {
        attr: "data-animation",
        valueAttr: "data-value",
        speed: 300,
        effect: "swing"
      },
      breakpoints: {
        xs: 0,
        sm: 576,
        md: 768,
        lg: 992,
        xl: 1200,
        xxl: 1660,
        xxxl: 1900
      }
    },
    handleScrollbar = function() {
      "use strict";
      for (var e = document.querySelectorAll("[" + app.scrollBar.attr + "]"), t = 0; t < e.length; t++) generateScrollbar(e[t])
    },


    generateScrollbar = function(e) {
      "use strict";
      var t;
      e.scrollbarInit || app.isMobile && e.getAttribute(app.scrollBar.skipMobileAttr) || (t = e.getAttribute(app.scrollBar.heightAttr) ? e.getAttribute(app.scrollBar.heightAttr) : e.offsetHeight, e.style.height = t, e.scrollbarInit = !0, app.isMobile ? e.style.overflowX = "scroll" : (t = !!e.getAttribute(app.scrollBar.wheelPropagationAttr) && e.getAttribute(app.scrollBar.wheelPropagationAttr), e.closest("." + app.sidebar.class) && 0 !== e.closest("." + app.sidebar.class).length ? app.sidebar.scrollBar.dom = new PerfectScrollbar(e, {
        wheelPropagation: t
      }) : new PerfectScrollbar(e, {
        wheelPropagation: t
      })), e.setAttribute(app.init.attr, !0), e.classList.remove("invisible"))
    },
    handleSidebarMenuToggle = function(a) {
      a.map(function(e) {
        e.onclick = function(e) {
          e.preventDefault();
          var t = this.nextElementSibling,
            e = (a.map(function(e) {
              e = e.nextElementSibling;
              e !== t && (e.style.display = "none", e.closest("." + app.sidebar.menu.itemClass).classList.remove(app.sidebar.menu.expandClass))
            }), t.closest("." + app.sidebar.menu.itemClass));
          e.classList.contains(app.sidebar.menu.expandClass) || e.classList.contains(app.sidebar.menu.activeClass) && !t.style.display ? (e.classList.remove(app.sidebar.menu.expandClass), t.style.display = "none") : (e.classList.add(app.sidebar.menu.expandClass), t.style.display = "block")
        }
      })
    },
    handleSidebarMenu = function() {
      "use strict";
      var e = "." + app.sidebar.class + " ." + app.sidebar.menu.class + " > ." + app.sidebar.menu.itemClass + "." + app.sidebar.menu.hasSubClass,
        t = " > ." + app.sidebar.menu.submenu.class + " > ." + app.sidebar.menu.itemClass + "." + app.sidebar.menu.hasSubClass,
        a = e + " > ." + app.sidebar.menu.itemLinkClass,
        a = [].slice.call(document.querySelectorAll(a));
      handleSidebarMenuToggle(a);
      a = [].slice.call(document.querySelectorAll(e + t + " > ." + app.sidebar.menu.itemLinkClass));
      handleSidebarMenuToggle(a);
      a = [].slice.call(document.querySelectorAll(e + t + t + " > ." + app.sidebar.menu.itemLinkClass));
      handleSidebarMenuToggle(a)
    },
    handleSidebarScrollMemory = function() {
      if (!app.isMobile) try {
        var e, t;
        "undefined" != typeof Storage && "undefined" != typeof localStorage && (e = document.querySelector("." + app.sidebar.class + " [" + app.scrollBar.attr + "]")) && (e.onscroll = function() {
          localStorage.setItem(app.sidebar.scrollBar.localStorage, this.scrollTop)
        }, t = localStorage.getItem(app.sidebar.scrollBar.localStorage)) && (document.querySelector("." + app.sidebar.class + " [" + app.scrollBar.attr + "]").scrollTop = t)
      } catch (e) {
        console.log(e)
      }
    },
    handleCardAction = function() {
      "use strict";
      if (app.card.expand.status) return !1;
      app.card.expand.status = !0;
      [].slice.call(document.querySelectorAll("[" + app.card.expand.toggleAttr + "]")).map(function(e) {
        return e.onclick = function(e) {
          e.preventDefault();
          var e = this.closest(".card"),
            t = app.card.expand.class;
          document.body.classList.contains(t) && e.classList.contains(t) ? (e.removeAttribute("style"), e.classList.remove(t), document.body.classList.remove(t)) : (document.body.classList.add(t), e.classList.add(t)), window.dispatchEvent(new Event("resize"))
        }, new bootstrap.Tooltip(e, {
          title: app.card.expand.toggleTitle,
          placement: "bottom",
          trigger: "hover",
          container: "body"
        })
      })
    },
    handelTooltipPopoverActivation = function() {
      "use strict";
      [].slice.call(document.querySelectorAll("[" + app.bootstrap.tooltip.attr + "]")).map(function(e) {
        return new bootstrap.Tooltip(e)
      }), [].slice.call(document.querySelectorAll("[" + app.bootstrap.popover.attr + "]")).map(function(e) {
        return new bootstrap.Popover(e)
      })
    },
    handleScrollToTopButton = function() {
      "use strict";
      var a = [].slice.call(document.querySelectorAll("[" + app.scrollToTopBtn.toggleAttr + "]"));
      document.onscroll = function() {
        var e = document.documentElement,
          t = (window.pageYOffset || e.scrollTop) - (e.clientTop || 0),
          e = (a.map(function(e) {
            t >= app.scrollToTopBtn.heightShow ? e.classList.contains(app.scrollToTopBtn.showClass) || e.classList.add(app.scrollToTopBtn.showClass) : e.classList.remove(app.scrollToTopBtn.showClass)
          }), document.querySelectorAll(app.id)[0]);
        0 < t ? e.classList.add(app.header.hasScrollClass) : e.classList.remove(app.header.hasScrollClass)
      }, a.map(function(e) {
        e.onclick = function(e) {
          e.preventDefault(), window.scrollTo({
            top: 0,
            behavior: "smooth"
          })
        }
      })
    },
    hexToRgba = function(e, t = 1) {
      if (/^#([A-Fa-f0-9]{3}){1,2}$/.test(e)) return "rgba(" + [(e = "0x" + (e = 3 == (e = e.substring(1).split("")).length ? [e[0], e[0], e[1], e[1], e[2], e[2]] : e).join("")) >> 16 & 255, e >> 8 & 255, 255 & e].join(",") + "," + t + ")";
      throw new Error("Bad Hex")
    },
    handleScrollTo = function() {
      [].slice.call(document.querySelectorAll("[" + app.scrollTo.attr + "]")).map(function(a) {
        a.onclick = function(e) {
          e.preventDefault();
          var e = a.getAttribute(app.scrollTo.target) ? this.getAttribute(app.scrollTo.target) : this.getAttribute(app.scrollTo.linkTarget),
            e = document.querySelectorAll(e)[0],
            t = document.querySelectorAll(app.header.id)[0].offsetHeight;
          e && (e = e.offsetTop - t - 24, window.scrollTo({
            top: e,
            behavior: "smooth"
          }))
        }
      })
    },
    handleToggleClass = function() {
      [].slice.call(document.querySelectorAll("[" + app.toggleClass.toggleAttr + "]")).map(function(e) {
        e.onclick = function(e) {
          e.preventDefault();
          var e = this.getAttribute(app.toggleClass.toggleAttr),
            t = this.getAttribute(app.dismissClass.toggleAttr),
            a = document.querySelector(this.getAttribute(app.toggleClass.targetAttr));
          t && (a.classList.contains(e) || a.classList.contains(t)) ? (a.classList.contains(e) ? a.classList.remove(e) : a.classList.add(e), a.classList.contains(t) ? a.classList.remove(t) : a.classList.add(t)) : a.classList.contains(e) ? a.classList.remove(e) : a.classList.add(e)
        }
      })
    },
    handleCssVariable = function() {
      var e = getComputedStyle(document.body);
      if (app.variableFontList && app.variablePrefix)
        for (var t = 0; t < app.variableFontList.length; t++) app.font[app.variableFontList[t].replace(/-([a-z|0-9])/g, (e, t) => t.toUpperCase())] = e.getPropertyValue("--" + app.variablePrefix + app.variableFontList[t]).trim();
      if (app.variableColorList && app.variablePrefix)
        for (t = 0; t < app.variableColorList.length; t++) app.color[app.variableColorList[t].replace(/-([a-z|0-9])/g, (e, t) => t.toUpperCase())] = e.getPropertyValue("--" + app.variablePrefix + app.variableColorList[t]).trim()
    },
    handleUnlimitedTopNavRender = function() {
      "use strict";

      function t(e, t) {
        var a = e.closest("." + app.topNav.menu.class),
          e = window.getComputedStyle(a),
          o = window.getComputedStyle(document.querySelector("body")),
          s = "rtl" == o.getPropertyValue("direction") ? "margin-right" : "margin-left",
          l = parseInt(e.getPropertyValue(s)),
          r = document.querySelector("." + app.topNav.class).clientWidth - 2 * document.querySelector("." + app.topNav.class).clientHeight,
          n = 0,
          i = 0,
          e = a.querySelector(".menu-control-start"),
          s = e ? e.clientWidth : 0,
          p = a.querySelector(".menu-control-end"),
          c = s + (e ? p.clientWidth : 0),
          s = [].slice.call(a.querySelectorAll("." + app.topNav.menu.itemClass));
        switch (s && s.map(function(e) {
          e.classList.contains(app.topNav.control.class) || (n += e.clientWidth)
        }), t) {
          case "next":
            (d = n + l - r) <= r ? (i = d - l - c, setTimeout(function() {
              a.querySelector("." + app.topNav.control.class + "." + app.topNav.control.buttonNext.class).classList.remove("show")
            }, app.animation.speed)) : i = r - l - c, 0 !== i && (a.style.transitionProperty = "height, margin, padding", a.style.transitionDuration = app.animation.speed + "ms", "rtl" != o.getPropertyValue("direction") ? a.style.marginLeft = "-" + i + "px" : a.style.marginRight = "-" + i + "px", setTimeout(function() {
              a.style.transitionProperty = "", a.style.transitionDuration = "", a.querySelector("." + app.topNav.control.class + "." + app.topNav.control.buttonPrev.class).classList.add("show")
            }, app.animation.speed));
            break;
          case "prev":
            var d, i = (d = -l) <= r ? (a.querySelector("." + app.topNav.control.class + "." + app.topNav.control.buttonPrev.class).classList.remove("show"), 0) : d - r + c;
            a.style.transitionProperty = "height, margin, padding", a.style.transitionDuration = app.animation.speed + "ms", "rtl" != o.getPropertyValue("direction") ? a.style.marginLeft = "-" + i + "px" : a.style.marginRight = "-" + i + "px", setTimeout(function() {
              a.style.transitionProperty = "", a.style.transitionDuration = "", a.querySelector("." + app.topNav.control.class + "." + app.topNav.control.buttonNext.class).classList.add("show")
            }, app.animation.speed)
        }
      }

      function a() {
        var e, t, a, o, s, l, r, n, i = document.querySelector("." + app.topNav.class + " ." + app.topNav.menu.class);
        i && (t = window.getComputedStyle(i), n = "rtl" == (e = window.getComputedStyle(document.body)).getPropertyValue("direction") ? "margin-right" : "margin-left", parseInt(t.getPropertyValue(n)), t = document.querySelector("." + app.topNav.class).clientWidth, o = a = 0, (n = i.querySelector(".menu-control-start")) && n.clientWidth, s = i.querySelector(".menu-control-end"), n = n ? s.clientWidth : 0, s = 0, (r = [].slice.call(document.querySelectorAll("." + app.topNav.class + " ." + app.topNav.menu.class + " > ." + app.topNav.menu.itemClass))) && (l = !1, r.map(function(e) {
          e.classList.contains("menu-control") || (o += e.clientWidth, l || (a += e.clientWidth), e.classList.contains("active") && (l = !0))
        })), r = i.querySelector("." + app.topNav.control.class + "." + app.topNav.control.buttonNext.class), a != o && t <= o ? (r.classList.add(app.topNav.control.showClass), s += n) : r.classList.remove(app.topNav.control.showClass), r = i.querySelector("." + app.topNav.control.class + "." + app.topNav.control.buttonPrev.class), t <= a && t <= o ? r.classList.add(app.topNav.control.showClass) : r.classList.remove(app.topNav.control.showClass), t <= a) && (n = a - t + s, "rtl" != e.getPropertyValue("direction") ? i.style.marginLeft = "-" + n + "px" : i.style.marginRight = "-" + n + "px")
      }
      var e = document.querySelector("[" + app.topNav.control.buttonNext.toggleAttr + "]");

      function o(e) {
        const r = document.querySelector(e);
        if (r) {
          const n = r.querySelector(".menu");
          e = n.querySelectorAll(".menu-item:not(.menu-control)");
          let t, a, o, s = 0,
            l = 0;
          e.forEach(e => {
            s += e.offsetWidth
          }), r.addEventListener("mousedown", e => {
            o = !0, t = e.pageX, a = n.style.marginLeft ? parseInt(n.style.marginLeft) : 0, l = r.offsetWidth - s
          }), r.addEventListener("touchstart", e => {
            o = !0;
            e = e.targetTouches[0];
            t = e.pageX, a = n.style.marginLeft ? parseInt(n.style.marginLeft) : 0, l = r.offsetWidth - s
          }), r.addEventListener("mouseup", () => {
            o = !1
          }), r.addEventListener("touchend", () => {
            o = !1
          }), r.addEventListener("mousemove", e => {
            t && o && (window.innerWidth < app.breakpoints.md || (e.preventDefault(), e = e.pageX - t, (e = a + e) <= l ? (e = l, n.querySelector("." + app.topNav.control.class + "." + app.topNav.control.buttonNext.class).classList.remove("show")) : n.querySelector("." + app.topNav.control.class + "." + app.topNav.control.buttonNext.class).classList.add("show"), s < r.offsetWidth && n.querySelector("." + app.topNav.control.class + "." + app.topNav.control.buttonPrev.class).classList.remove("show"), 0 < l && n.querySelector("." + app.topNav.control.class + "." + app.topNav.control.buttonNext.class).classList.remove("show"), 0 < e ? (e = 0, n.querySelector("." + app.topNav.control.class + "." + app.topNav.control.buttonPrev.class).classList.remove("show")) : n.querySelector("." + app.topNav.control.class + "." + app.topNav.control.buttonPrev.class).classList.add("show"), n.style.marginLeft = e + "px"))
          }), r.addEventListener("touchmove", e => {
            t && o && (window.innerWidth < app.breakpoints.md || (e.preventDefault(), e = e.targetTouches[0].pageX - t, (e = a + e) <= l ? (e = l, n.querySelector("." + app.topNav.control.class + "." + app.topNav.control.buttonNext.class).classList.remove("show")) : n.querySelector("." + app.topNav.control.class + "." + app.topNav.control.buttonNext.class).classList.add("show"), s < r.offsetWidth && n.querySelector("." + app.topNav.control.class + "." + app.topNav.control.buttonPrev.class).classList.remove("show"), 0 < l && n.querySelector("." + app.topNav.control.class + "." + app.topNav.control.buttonNext.class).classList.remove("show"), 0 < e ? (e = 0, n.querySelector("." + app.topNav.control.class + "." + app.topNav.control.buttonPrev.class).classList.remove("show")) : n.querySelector("." + app.topNav.control.class + "." + app.topNav.control.buttonPrev.class).classList.add("show"), n.style.marginLeft = e + "px"))
          })
        }
      }
      e && (e.onclick = function(e) {
        e.preventDefault(), t(this, "next")
      }), (e = document.querySelector("[" + app.topNav.control.buttonPrev.toggleAttr + "]")) && (e.onclick = function(e) {
        e.preventDefault(), t(this, "prev")
      }), window.addEventListener("resize", function() {
        var e;
        window.innerWidth >= app.breakpoints.md && ((e = document.querySelector("." + app.topNav.class)) && e.removeAttribute("style"), (e = document.querySelector("." + app.topNav.class + " ." + app.topNav.menu.class)) && e.removeAttribute("style"), (e = document.querySelectorAll("." + app.topNav.class + " ." + app.topNav.menu.submenu.class)) && e.forEach(e => {
          e.removeAttribute("style")
        }), a()), o("." + app.topNav.class)
      }), window.innerWidth >= app.breakpoints.md && (a(), o("." + app.topNav.class))
    },
    handleTopNavToggle = function(a, o = !1) {
      a.map(function(e) {
        e.onclick = function(e) {
          var t;
          e.preventDefault(), (!o || document.body.clientWidth < app.breakpoints.md) && (t = this.nextElementSibling, a.map(function(e) {
            e = e.nextElementSibling;
            e !== t && (slideUp(e), e.closest("." + app.topNav.menu.itemClass).classList.remove(app.topNav.menu.expandClass), e.closest("." + app.topNav.menu.itemClass).classList.add(app.topNav.menu.closedClass))
          }), slideToggle(t))
        }
      })
    },
    handleTopNavSubMenu = function() {
      "use strict";
      var e = "." + app.topNav.class + " ." + app.topNav.menu.class + " > ." + app.topNav.menu.itemClass + "." + app.topNav.menu.hasSubClass,
        t = " > ." + app.topNav.menu.submenu.class + " > ." + app.topNav.menu.itemClass + "." + app.topNav.menu.hasSubClass,
        a = e + " > ." + app.topNav.menu.itemLinkClass,
        a = [].slice.call(document.querySelectorAll(a));
      handleTopNavToggle(a, !0);
      a = [].slice.call(document.querySelectorAll(e + t + " > ." + app.topNav.menu.itemLinkClass));
      handleTopNavToggle(a);
      a = [].slice.call(document.querySelectorAll(e + t + t + " > ." + app.topNav.menu.itemLinkClass));
      handleTopNavToggle(a)
    },
    handleTopNavMobileToggle = function() {
      "use strict";
      var e = document.querySelector("[" + app.topNav.mobile.toggleAttr + "]");
      e && (e.onclick = function(e) {
        e.preventDefault(), slideToggle(document.querySelector("." + app.topNav.class)), window.scrollTo(0, 0)
      })
    },
    slideUp = function(e, t = app.animation.speed) {
      e.classList.contains("transitioning") || (e.classList.add("transitioning"), e.style.transitionProperty = "height, margin, padding", e.style.transitionDuration = t + "ms", e.style.boxSizing = "border-box", e.style.height = e.offsetHeight + "px", e.offsetHeight, e.style.overflow = "hidden", e.style.height = 0, e.style.paddingTop = 0, e.style.paddingBottom = 0, e.style.marginTop = 0, e.style.marginBottom = 0, window.setTimeout(() => {
        e.style.display = "none", e.style.removeProperty("height"), e.style.removeProperty("padding-top"), e.style.removeProperty("padding-bottom"), e.style.removeProperty("margin-top"), e.style.removeProperty("margin-bottom"), e.style.removeProperty("overflow"), e.style.removeProperty("transition-duration"), e.style.removeProperty("transition-property"), e.classList.remove("transitioning")
      }, t))
    },
    slideDown = function(t, a = app.animation.speed) {
      if (!t.classList.contains("transitioning")) {
        t.classList.add("transitioning"), t.style.removeProperty("display");
        let e = window.getComputedStyle(t).display;
        "none" === e && (e = "block"), t.style.display = e;
        var o = t.offsetHeight;
        t.style.overflow = "hidden", t.style.height = 0, t.style.paddingTop = 0, t.style.paddingBottom = 0, t.style.marginTop = 0, t.style.marginBottom = 0, t.offsetHeight, t.style.boxSizing = "border-box", t.style.transitionProperty = "height, margin, padding", t.style.transitionDuration = a + "ms", t.style.height = o + "px", t.style.removeProperty("padding-top"), t.style.removeProperty("padding-bottom"), t.style.removeProperty("margin-top"), t.style.removeProperty("margin-bottom"), window.setTimeout(() => {
          t.style.removeProperty("height"), t.style.removeProperty("overflow"), t.style.removeProperty("transition-duration"), t.style.removeProperty("transition-property"), t.classList.remove("transitioning")
        }, a)
      }
    },
    slideToggle = function(e, t = app.animation.speed) {
      return ("none" === window.getComputedStyle(e).display ? slideDown : slideUp)(e, t)
    },
    App = function() {
      "use strict";
      return {
        init: function() {
          this.initComponent(), this.initSidebar(), this.initTopNav(), this.initAppLoad()
        },
        initAppLoad: function() {
          document.querySelector("body").classList.add(app.init.class)
        },
        initSidebar: function() {
          handleSidebarMenu(), handleSidebarScrollMemory()
        },
        initTopNav: function() {
          handleUnlimitedTopNavRender(), handleTopNavSubMenu(), handleTopNavMobileToggle()
        },
        initComponent: function() {
          handleScrollbar(), handleScrollToTopButton(), handleScrollTo(), handleCardAction(), handelTooltipPopoverActivation(), handleToggleClass(), handleCssVariable()
        },
        scrollTop: function() {
          window.scrollTo({
            top: 0,
            behavior: "smooth"
          })
        }
      }
    }();



    $(document).ready(function() {
       setTimeout(function() {
         App.init();
       }, 500); // Adjust the time as necessary
     });




});



function isSuperAdmin(user) {
  return user && user.role === 'superAdmin';
}

Template.registerHelper('log', function() {
  console.log.apply(console, arguments);
});

Template.products.onCreated(function() {
  this.autorun(() => {
    const user = Meteor.user();
    console.log('Subscribing to products, user role:', user ? user.role : 'No user');
    Meteor.subscribe('userProducts');
  });
});

Accounts.onLoginFailure(function(error) {
  console.log('Login failure details:', {
    error: error,
    user: Meteor.user(),
    connectionId: Meteor.connection._lastSessionId
  });
});

Accounts.onCreateUserFailure = function(error) {
  console.log('Registration failure details:', {
    error: error,
    attemptedUsername: error.details?.username,
    timestamp: new Date()
  });
};



