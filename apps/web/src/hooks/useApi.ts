// API client hook
import { useCallback } from 'react';
import type { Job, CreateJobRequest, MediaFile, User } from '@otonom/shared-types';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export function useApi() {
  const request = useCallback(async <T>(endpoint: string, options: RequestInit = {}): Promise<T> => {
    const token = localStorage.getItem('accessToken');
    
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || `HTTP ${response.status}`);
    }

    return data.data as T;
  }, []);

  return { request };
}

export function useAuth() {
  const { request } = useApi();

  const login = useCallback(async (email: string, password: string) => {
    const data = await request<{ user: User; accessToken: string; refreshToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    return data.user;
  }, [request]);

  const register = useCallback(async (email: string, password: string, name: string) => {
    const data = await request<{ user: User; accessToken: string; refreshToken: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    });
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    return data.user;
  }, [request]);

  const logout = useCallback(() => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
  }, []);

  const getMe = useCallback(async () => {
    return request<User>('/auth/me');
  }, [request]);

  return { login, register, logout, getMe };
}

export function useJob() {
  const { request } = useApi();

  const createJob = useCallback(async (jobData: CreateJobRequest) => {
    const data = await request<{ jobId: string }>('/jobs', {
      method: 'POST',
      body: JSON.stringify(jobData),
    });
    return data.jobId;
  }, [request]);

  const startJob = useCallback(async (jobId: string) => {
    return request<{ success: boolean }>(`/render`, {
      method: 'POST',
      body: JSON.stringify({ jobId }),
    });
  }, [request]);

  const getJobStatus = useCallback(async (jobId: string) => {
    return request<Job>(`/jobs/${jobId}`);
  }, [request]);

  const listJobs = useCallback(async (params?: { page?: number; pageSize?: number; status?: string }) => {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    return request<{ items: Job[]; total: number; page: number; pageSize: number; hasMore: boolean }>(`/jobs?${query}`);
  }, [request]);

  const cancelJob = useCallback(async (jobId: string) => {
    return request<{ success: boolean }>(`/jobs/${jobId}`, { method: 'DELETE' });
  }, [request]);

  return { createJob, startJob, getJobStatus, listJobs, cancelJob };
}

export function useMedia() {
  const { request } = useApi();

  const uploadFile = useCallback(async (file: File, onProgress?: (progress: number) => void) => {
    // 1. Get presigned URL
    const { uploadUrl, mediaId, expiresAt } = await request<{ uploadUrl: string; mediaId: string; expiresAt: number }>('/media/upload', {
      method: 'POST',
      body: JSON.stringify({
        filename: file.name,
        mimeType: file.type,
        size: file.size,
      }),
    });

    // 2. Upload to R2
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type },
    });

    if (!response.ok) {
      throw new Error('Upload failed');
    }

    // 3. Return media info
    return { mediaId, url: uploadUrl.split('?')[0] };
  }, [request]);

  const listMedia = useCallback(async (params?: { page?: number; pageSize?: number; type?: string }) => {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    return request<{ items: MediaFile[]; total: number; page: number; pageSize: number; hasMore: boolean }>(`/media?${query}`);
  }, [request]);

  const deleteMedia = useCallback(async (mediaIds: string[]) => {
    return request<{ deleted: number; failed: number }>('/media', {
      method: 'DELETE',
      body: JSON.stringify({ mediaIds }),
    });
  }, [request]);

  return { uploadFile, listMedia, deleteMedia };
}
