/**
 * Sber Speech Recognition Service
 *
 * Provides audio transcription using Sber's SmartSpeech API.
 */

import axios from 'axios';
import https from 'https';
import { randomUUID } from 'crypto';

const TOKEN_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
const SPEECH_URL = 'https://smartspeech.sber.ru/rest/v1/speech:recognize';
const API_VERSION = 'SALUTE_SPEECH_PERS';
const AUTH_TIMEOUT = 30000;
const SPEECH_TIMEOUT = 30000;

export class SberTranscriptionService {
  private cachedToken: string | null = null;
  private tokenExpiry: number | null = null;
  private httpsAgent: https.Agent;

  constructor(private clientSecret: string) {
    // Create HTTPS agent to handle SSL certificate issues with Russian government APIs
    this.httpsAgent = new https.Agent({
      rejectUnauthorized: false
    });
  }

  /**
   * Get OAuth token from Sber API with caching
   */
  private async getAuthToken(): Promise<string> {
    // Return cached token if still valid (with 5 minute buffer)
    if (this.cachedToken && this.tokenExpiry && Date.now() < this.tokenExpiry - 300000) {
      const timeRemaining = Math.floor((this.tokenExpiry - Date.now()) / 1000);
      console.log(`[Sber Auth] Using cached token (expires in ${timeRemaining}s)`);
      return this.cachedToken;
    }

    const rqUID = randomUUID();

    const headers = {
      'Authorization': `Basic ${this.clientSecret}`,
      'RqUID': rqUID,
      'Content-Type': 'application/x-www-form-urlencoded'
    };

    const params = new URLSearchParams();
    params.append('scope', API_VERSION);

    console.log(`[Sber Auth] Requesting new OAuth token...`);

    try {
      const response = await axios.post(TOKEN_URL, params, {
        headers,
        timeout: AUTH_TIMEOUT,
        httpsAgent: this.httpsAgent
      });

      this.cachedToken = response.data.access_token;

      // Set expiry (tokens typically valid for 30 minutes)
      const expiresIn = response.data.expires_at || 1800;
      this.tokenExpiry = Date.now() + (expiresIn * 1000);

      console.log(`[Sber Auth] Token obtained successfully (expires in ${expiresIn}s)`);

      if (!this.cachedToken) {
        throw new Error('Failed to obtain access token');
      }

      return this.cachedToken;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[Sber Auth] Failed to get OAuth token:', errorMessage);
      throw new Error(`Sber authentication failed: ${errorMessage}`);
    }
  }

  /**
   * Transcribe audio buffer to text
   */
  async transcribe(audioBuffer: Buffer): Promise<string> {
    return this.transcribeWithRetry(audioBuffer, false);
  }

  /**
   * Internal transcribe method with retry logic for 401 errors
   */
  private async transcribeWithRetry(audioBuffer: Buffer, isRetry: boolean): Promise<string> {
    try {
      const token = await this.getAuthToken();

      console.log('[Sber Transcribe] Sending audio for transcription...');

      const response = await axios.post(SPEECH_URL, audioBuffer, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'audio/mpeg'
        },
        timeout: SPEECH_TIMEOUT,
        httpsAgent: this.httpsAgent
      });

      const result = response.data?.result;
      const confidence = response.data?.confidence || 0;

      // Handle both string and array results
      let text = '';
      if (typeof result === 'string') {
        text = result;
      } else if (Array.isArray(result) && result.length > 0) {
        // Join all array elements or take the first one
        text = result.join(' ');
      }

      console.log(`[Sber Transcribe] Transcription complete (confidence: ${confidence})`);

      if (!text || text.trim().length === 0) {
        console.log('[Sber Transcribe] No speech detected in audio');
        console.log('[Sber Transcribe] Response data:', JSON.stringify(response.data, null, 2));
        return '';
      }

      return text;
    } catch (error) {
      // Handle 401 Unauthorized - token might have expired server-side
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        if (!isRetry) {
          console.log('[Sber Transcribe] Got 401, invalidating cached token and retrying...');
          // Invalidate cached token
          this.cachedToken = null;
          this.tokenExpiry = null;
          // Retry once with a fresh token
          return this.transcribeWithRetry(audioBuffer, true);
        } else {
          console.error('[Sber Transcribe] Got 401 even after token refresh');
        }
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[Sber Transcribe] Transcription failed:', errorMessage);
      throw new Error(`Sber transcription failed: ${errorMessage}`);
    }
  }
}
