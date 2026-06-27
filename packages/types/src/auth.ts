import { z } from 'zod';

export const LoginBody = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});
export type LoginBody = z.infer<typeof LoginBody>;

export interface LoginResponse {
  accessToken: string;
}
