export const rateLimitedMessage:string;
export class RateLimited extends Error {
 readonly retryAfterMs:number;
 constructor(response:Response);
}
