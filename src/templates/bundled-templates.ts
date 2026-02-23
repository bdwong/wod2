import dockerComposeHbs from "../../template/php8.2/docker-compose.yml.hbs" with { type: "text" };
import dockerfileHbs from "../../template/php8.2/wp-php-custom/Dockerfile.hbs" with {
  type: "text",
};
import defaultIni from "../../template/php8.2/wp-php-custom/default.ini" with { type: "text" };

export interface BundledTemplateFile {
  relativePath: string;
  content: string;
}

export interface BundledTemplate {
  name: string;
  files: BundledTemplateFile[];
}

export const BUNDLED_TEMPLATES: BundledTemplate[] = [
  {
    name: "php8.2",
    files: [
      { relativePath: "docker-compose.yml.hbs", content: dockerComposeHbs },
      { relativePath: "wp-php-custom/Dockerfile.hbs", content: dockerfileHbs },
      { relativePath: "wp-php-custom/default.ini", content: defaultIni },
    ],
  },
];
