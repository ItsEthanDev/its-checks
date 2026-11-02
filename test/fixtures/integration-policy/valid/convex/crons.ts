import { cronJobs, makeFunctionReference } from "convex/server";

const crons = cronJobs();
crons.hourly("cleanup", { minuteUTC: 37 }, makeFunctionReference<"mutation">("jobs:cleanup"));
export default crons;
