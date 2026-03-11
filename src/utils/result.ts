export type Result<T, E = Error> = 
  | { success: true; data: T }
  | { success: false; error: E };

export const success = <T>(data: T): Result<T, any> => ({
  success: true,
  data,
});

export const failure = <E>(error: E): Result<any, E> => ({
  success: false,
  error,
});
