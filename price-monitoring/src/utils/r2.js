/**
 * Утилита для работы с Cloudflare R2 (S3-совместимый API).
 * Загрузка и удаление фотографий для карточек VSE4.
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import fs from 'fs/promises';
import path from 'path';

/**
 * Создаёт S3-клиент для Cloudflare R2.
 * @param {Object} config - { r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2BucketName }
 */
function createClient(config) {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${config.r2AccountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.r2AccessKeyId,
      secretAccessKey: config.r2SecretAccessKey,
    },
  });
}

/**
 * Загружает один файл в R2.
 * @param {Object} config
 * @param {string} localPath  - абсолютный путь к файлу на диске
 * @param {string} key        - ключ в R2 (например "vse4/VSE257/photo.jpg")
 * @returns {Promise<string>} публичный URL файла
 */
export async function uploadFile(config, localPath, key) {
  const client = createClient(config);
  const body = await fs.readFile(localPath);
  const ext = path.extname(localPath).toLowerCase();
  const contentTypeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
  const contentType = contentTypeMap[ext] || 'application/octet-stream';

  await client.send(new PutObjectCommand({
    Bucket: config.r2BucketName,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));

  return `${config.r2PublicUrl}/${key}`;
}

/**
 * Удаляет все файлы карточки из R2 по префиксу vse4/{vseId}/.
 * Вызывается при импорте Авито-ссылок (ImageUrls обновлены → старые файлы не нужны).
 * @param {Object} config
 * @param {string} vseId - ID карточки, например "VSE257"
 * @returns {Promise<number>} количество удалённых объектов
 */
export async function deleteCardPhotos(config, vseId) {
  const client = createClient(config);
  const prefix = `vse4/${vseId}/`;

  const listed = await client.send(new ListObjectsV2Command({
    Bucket: config.r2BucketName,
    Prefix: prefix,
  }));

  if (!listed.Contents || listed.Contents.length === 0) return 0;

  await client.send(new DeleteObjectsCommand({
    Bucket: config.r2BucketName,
    Delete: {
      Objects: listed.Contents.map(obj => ({ Key: obj.Key })),
      Quiet: true,
    },
  }));

  return listed.Contents.length;
}

/**
 * Проверяет, начинается ли URL с публичного домена R2 (признак временного хранилища).
 * @param {string} url
 * @param {string} r2PublicUrl
 */
export function isR2Url(url, r2PublicUrl) {
  return url && r2PublicUrl && url.startsWith(r2PublicUrl);
}
