import { Memory } from "./memory";
import { CPU } from "./cpu";
import { Timer } from "./timer";

const memory = new Memory();
const cpu = new CPU(memory);
const timer = new Timer(memory);

console.log("Game Boy CPU ready");