import defaultDockerComposeHbs from "../../template/default/docker-compose.yml.hbs" with { type: "text" };
import defaultDockerfileHbs from "../../template/default/wp-php-custom/Dockerfile.hbs" with { type: "text" };
import defaultDefaultIni from "../../template/default/wp-php-custom/default.ini" with { type: "text" };

import noMcryptDockerComposeHbs from "../../template/no-mcrypt/docker-compose.yml.hbs" with { type: "text" };
import noMcryptDockerfileHbs from "../../template/no-mcrypt/wp-php-custom/Dockerfile.hbs" with { type: "text" };
import noMcryptDefaultIni from "../../template/no-mcrypt/wp-php-custom/default.ini" with { type: "text" };

import php74DockerComposeHbs from "../../template/php7.4/docker-compose.yml.hbs" with { type: "text" };
import php74DockerfileHbs from "../../template/php7.4/wp-php-custom/Dockerfile.hbs" with { type: "text" };
import php74DefaultIni from "../../template/php7.4/wp-php-custom/default.ini" with { type: "text" };

import php81DockerComposeHbs from "../../template/php8.1/docker-compose.yml.hbs" with { type: "text" };
import php81DockerfileHbs from "../../template/php8.1/wp-php-custom/Dockerfile.hbs" with { type: "text" };
import php81DefaultIni from "../../template/php8.1/wp-php-custom/default.ini" with { type: "text" };

import php82DockerComposeHbs from "../../template/php8.2/docker-compose.yml.hbs" with { type: "text" };
import php82DockerfileHbs from "../../template/php8.2/wp-php-custom/Dockerfile.hbs" with { type: "text" };
import php82DefaultIni from "../../template/php8.2/wp-php-custom/default.ini" with { type: "text" };

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
    name: "default",
    files: [
      { relativePath: "docker-compose.yml.hbs", content: defaultDockerComposeHbs },
      { relativePath: "wp-php-custom/Dockerfile.hbs", content: defaultDockerfileHbs },
      { relativePath: "wp-php-custom/default.ini", content: defaultDefaultIni },
    ],
  },
  {
    name: "no-mcrypt",
    files: [
      { relativePath: "docker-compose.yml.hbs", content: noMcryptDockerComposeHbs },
      { relativePath: "wp-php-custom/Dockerfile.hbs", content: noMcryptDockerfileHbs },
      { relativePath: "wp-php-custom/default.ini", content: noMcryptDefaultIni },
    ],
  },
  {
    name: "php7.4",
    files: [
      { relativePath: "docker-compose.yml.hbs", content: php74DockerComposeHbs },
      { relativePath: "wp-php-custom/Dockerfile.hbs", content: php74DockerfileHbs },
      { relativePath: "wp-php-custom/default.ini", content: php74DefaultIni },
    ],
  },
  {
    name: "php8.1",
    files: [
      { relativePath: "docker-compose.yml.hbs", content: php81DockerComposeHbs },
      { relativePath: "wp-php-custom/Dockerfile.hbs", content: php81DockerfileHbs },
      { relativePath: "wp-php-custom/default.ini", content: php81DefaultIni },
    ],
  },
  {
    name: "php8.2",
    files: [
      { relativePath: "docker-compose.yml.hbs", content: php82DockerComposeHbs },
      { relativePath: "wp-php-custom/Dockerfile.hbs", content: php82DockerfileHbs },
      { relativePath: "wp-php-custom/default.ini", content: php82DefaultIni },
    ],
  },
];
