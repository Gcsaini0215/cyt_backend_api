import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import FileMeta from "../models/FileMeta.js";
export async function getPutObjectUrl(file, folderName = "profile") {
  const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  let filename = `${uuidv4()}_${file.filename}`;
  const fileKey = `${folderName}/${filename}`;
  const fileContent = fs.readFileSync(file.path);
  const command = new PutObjectCommand({
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: fileKey,
    Body: fileContent,
    ContentType: file.mimetype,
  });

  try {
    const res = await s3Client.send(command);
    await saveFileMetadata(fileKey, file);
    return fileKey;
  } catch (err) {
    return false;
  }
}

export async function getObjectUrl(key, type = "pdf") {
  const s3Client = new S3Client({
    region: process.env.AWS_BUCKET_NAME,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  const command = new GetObjectCommand({
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: key,
    ContentType: type == "image" ? "image/jpg" : "application/pdf",
  });
  const url = await getSignedUrl(s3Client, command, { expiresIn: 604800 });
  return url;
}

export const saveFileMetadata = async (filekey, file) => {
  const newFile = new FileMeta({
    url: filekey, // S3 file URL
    fileName: file.originalname,
    fileSize: file.size,
    fileType: file.mimetype,
  });
  await newFile.save(); // Save file metadata to the database
};
