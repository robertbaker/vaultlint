import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";
import { BRAND_DESCRIPTION, BRAND_LINKS, BRAND_NAME, BRAND_THEME_COLOR } from "@vaultlint/brand";
import icon from "astro-icon";
import { defineConfig } from "astro/config";

const site = process.env.ASTRO_SITE ?? "https://robertbaker.github.io";
const base = process.env.ASTRO_BASE ?? "/";
const basePath = base.endsWith("/") ? base : `${base}/`;

export default defineConfig({
  site,
  base,
  vite: {
    plugins: [tailwindcss()],
    build: {
      minify: true,
      cssMinify: true,
      rolldownOptions: {
        treeshake: true,
      },
    },
  },
  integrations: [
    icon(),
    starlight({
      title: BRAND_NAME,
      description: BRAND_DESCRIPTION,
      favicon: "favicon.svg",
      head: [
        {
          tag: "meta",
          attrs: {
            name: "color-scheme",
            content: "light dark",
          },
        },
        {
          tag: "meta",
          attrs: {
            name: "theme-color",
            content: BRAND_THEME_COLOR.light,
            media: "(prefers-color-scheme: light)",
          },
        },
        {
          tag: "meta",
          attrs: {
            name: "theme-color",
            content: BRAND_THEME_COLOR.dark,
            media: "(prefers-color-scheme: dark)",
          },
        },
        { tag: "meta", attrs: { property: "og:site_name", content: BRAND_NAME } },
        { tag: "meta", attrs: { name: "twitter:card", content: "summary" } },
        {
          tag: "script",
          attrs: { type: "application/ld+json" },
          content: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: BRAND_NAME,
            description: BRAND_DESCRIPTION,
            applicationCategory: "SecurityApplication",
            operatingSystem: "Any (browser, Node.js CLI)",
            license: BRAND_LINKS.license,
            codeRepository: BRAND_LINKS.repository,
            offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          }),
        },
        {
          tag: "link",
          attrs: {
            rel: "icon",
            href: `${basePath}favicon.png`,
            type: "image/png",
            sizes: "64x64",
          },
        },
      ],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: BRAND_LINKS.repository,
        },
      ],
      // Wrap long commands instead of scrolling sideways: easier to read on phones, and no
      // keyboard-unreachable horizontal scroll regions (WCAG 2.1.1).
      expressiveCode: { defaultProps: { wrap: true } },
      customCss: ["./src/styles/custom.css"],
      components: {
        Footer: "./src/components/Footer.astro",
        Hero: "./src/components/Hero.astro",
        SiteTitle: "./src/components/SiteTitle.astro",
      },
      sidebar: [
        {
          label: "Guides",
          items: [
            { label: "Getting Started", slug: "guides/getting-started" },
            { label: "Web UI Guide", slug: "guides/web-ui" },
            { label: "Password Health & URIs", slug: "guides/password-health" },
            { label: "Batch Editing & Domains", slug: "guides/batch-editing" },
            { label: "Aegis FIDO Import", slug: "guides/aegis-fido" },
            { label: "AI Categorization (Opt-In)", slug: "guides/ai-categorization" },
            { label: "Troubleshooting", slug: "guides/troubleshooting" },
          ],
        },
        {
          label: "CLI & Formats",
          items: [
            { label: "CLI Quick Start", slug: "cli" },
            { label: "CLI Reference", slug: "cli/commands" },
            { label: "Supported Formats", slug: "cli/formats" },
            { label: "Format Schema Reference", slug: "cli/format-schemas" },
          ],
        },
        {
          label: "Security",
          items: [
            { label: "Local-First Architecture", slug: "security/local-first" },
            { label: "Privacy Policy", slug: "security/privacy-policy" },
          ],
        },
        { label: "Changelog", slug: "changelog" },
      ],
    }),
  ],
});
