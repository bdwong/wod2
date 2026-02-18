export const DOCKER_COMPOSE_TEMPLATE = `services:
   db:
      image: mysql:5.7
      volumes:
         - db_data:/var/lib/mysql
      restart: always
      environment:
         MYSQL_ROOT_PASSWORD: wordpress
         MYSQL_DATABASE: wordpress
         MYSQL_USER: wordpress
         MYSQL_PASSWORD: wordpress

   wordpress:
      depends_on:
         - db
      build: ./wp-php-custom
      image: wordpress:6.5.4-php8.2-custom
      volumes:
         - ./site:/var/www/html
      ports:
         - "8000:80"
      restart: always
      environment:
         WORDPRESS_DB_HOST: db:3306
         WORDPRESS_DB_USER: wordpress
         WORDPRESS_DB_PASSWORD: wordpress
volumes:
   db_data:
`;

export const DOCKERFILE_TEMPLATE = `FROM wordpress:6.5.4-php8.2-apache

# Install PHP extensions for image processing
RUN apt-get update && apt-get install -y \\
        libfreetype6-dev \\
        libjpeg62-turbo-dev \\
        libpng-dev \\
    && docker-php-ext-install -j$(nproc) iconv \\
    && docker-php-ext-configure gd \\
    && docker-php-ext-install -j$(nproc) gd

# PHP config: increase upload limits
COPY default.ini /usr/local/etc/php/conf.d/default.ini

# Apache: AllowOverride All for .htaccess support
RUN sed -i \\
        -e '/<\\/VirtualHost>/i\\' \\
        -e '        <Directory "/var/www/html">\\' \\
        -e '                Options Indexes FollowSymLinks MultiViews\\' \\
        -e '                AllowOverride All\\' \\
        -e '        </Directory>' \\
        /etc/apache2/sites-available/000-default.conf
`;

export const DEFAULT_INI_TEMPLATE = `upload_max_filesize=100M
post_max_size = 100M
`;
