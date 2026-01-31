/**
 * Audio Converter Service
 *
 * Converts audio files between formats using ffmpeg.
 */

import ffmpeg from 'fluent-ffmpeg';
import { Readable } from 'stream';

export class AudioConverter {
  /**
   * Converts OGG audio buffer to MP3 format
   * @param oggBuffer - OGG audio file as buffer
   * @returns MP3 audio file as buffer
   */
  async convertOggToMp3(oggBuffer: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const inputStream = Readable.from(oggBuffer);

      ffmpeg(inputStream)
        .inputFormat('ogg')
        .toFormat('mp3')
        .audioBitrate('128k')
        .on('error', (err) => {
          reject(new Error(`Audio conversion failed: ${err.message}`));
        })
        .on('end', () => {
          resolve(Buffer.concat(chunks));
        })
        .pipe()
        .on('data', (chunk: Buffer) => chunks.push(chunk))
        .on('error', (err) => {
          reject(new Error(`Stream error: ${err.message}`));
        });
    });
  }
}
