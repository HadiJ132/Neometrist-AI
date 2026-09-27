import type { QueryKey, UseMutationOptions, UseMutationResult, UseQueryOptions, UseQueryResult } from '@tanstack/react-query';
import type { AgentReviewRequest, AgentReviewResponse, HealthStatus } from './api.schemas';
import { customFetch } from '../custom-fetch';
import type { ErrorType, BodyType } from '../custom-fetch';
type AwaitedInput<T> = PromiseLike<T> | T;
type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;
type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];
export declare const getHealthCheckUrl: () => string;
/**
 * Returns server health status
 * @summary Health check
 */
export declare const healthCheck: (options?: Parameters<typeof customFetch>[1]) => Promise<HealthStatus>;
export declare const getHealthCheckQueryKey: () => readonly ["/api/healthz"];
export declare const getHealthCheckQueryOptions: <TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData> & {
    queryKey: QueryKey;
};
export type HealthCheckQueryResult = NonNullable<Awaited<ReturnType<typeof healthCheck>>>;
export type HealthCheckQueryError = ErrorType<unknown>;
/**
 * @summary Health check
 */
export declare function useHealthCheck<TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getReviewBeamWithMathAgentUrl: () => string;
/**
 * @summary Review a completed beam result with the Math AI Agent
 */
export declare const reviewBeamWithMathAgent: (agentReviewRequest: AgentReviewRequest, options?: Parameters<typeof customFetch>[1]) => Promise<AgentReviewResponse>;
export declare const getReviewBeamWithMathAgentMutationKey: () => readonly ["reviewBeamWithMathAgent"];
export declare const getReviewBeamWithMathAgentMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof reviewBeamWithMathAgent>>, TError, ReviewBeamWithMathAgentMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof reviewBeamWithMathAgent>>, TError, ReviewBeamWithMathAgentMutationVariables, TContext>;
export type ReviewBeamWithMathAgentMutationResult = NonNullable<Awaited<ReturnType<typeof reviewBeamWithMathAgent>>>;
export type ReviewBeamWithMathAgentMutationBody = BodyType<AgentReviewRequest>;
export type ReviewBeamWithMathAgentMutationError = ErrorType<void>;
export type ReviewBeamWithMathAgentMutationVariables = {
    data: BodyType<AgentReviewRequest>;
};
/**
* @summary Review a completed beam result with the Math AI Agent
*/
export declare const useReviewBeamWithMathAgent: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof reviewBeamWithMathAgent>>, TError, ReviewBeamWithMathAgentMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof reviewBeamWithMathAgent>>, TError, ReviewBeamWithMathAgentMutationVariables, TContext>;
export {};
//# sourceMappingURL=api.d.ts.map