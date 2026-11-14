import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DeployDoctor",
    short_name: "DeployDoctor",
    description: "Scan a GitHub repository for deployment risks before you push.",
    start_url: "/",
    display: "browser",
    background_color: "#f4f2eb",
    theme_color: "#10231c",
    lang: "en",
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
