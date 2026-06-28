import type { FilterMetaData } from "@/filter/metadata";

export interface FilterEngine {
  check(expression: string): { ok: boolean; error?: string };
  execute(expression: string, meta: FilterMetaData): boolean;
}

type TokenType =
  | "identifier"
  | "number"
  | "string"
  | "regex"
  | "date"
  | "operator"
  | "paren"
  | "eof";

interface Token {
  type: TokenType;
  value: string;
  position: number;
}

type FilterValue = boolean | number | string | Date | RegExp | undefined;

const aliases: Record<string, keyof FilterMetaData> = {
  id: "message_id",
  caption: "message_caption",
  file_size: "media_file_size",
  file_name: "media_file_name",
  topic_id: "message_thread_id",
};

const byteUnits: Record<string, number> = {
  B: 1,
  KB: 1024,
  MB: 1024 ** 2,
  GB: 1024 ** 3,
  TB: 1024 ** 4,
};

function isDigit(char: string) {
  return char >= "0" && char <= "9";
}

function isIdentifierStart(char: string) {
  return /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char: string) {
  return /[A-Za-z0-9_]/.test(char);
}

function tokenize(input: string) {
  const tokens: Token[] = [];
  let index = 0;

  while (index < input.length) {
    const char = input[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    const rest = input.slice(index);
    const date = rest.match(/^\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{1,2}:\d{1,2}/);
    if (date) {
      tokens.push({ type: "date", value: date[0], position: index });
      index += date[0].length;
      continue;
    }

    const twoChar = input.slice(index, index + 2);
    if ([">=", "<=", "==", "!=", "&&", "||"].includes(twoChar)) {
      tokens.push({ type: "operator", value: twoChar, position: index });
      index += 2;
      continue;
    }

    if (["+", "-", "*", "/", ">", "<"].includes(char)) {
      tokens.push({ type: "operator", value: char, position: index });
      index += 1;
      continue;
    }

    if (char === "(" || char === ")") {
      tokens.push({ type: "paren", value: char, position: index });
      index += 1;
      continue;
    }

    if (char === "r" && input[index + 1] === "'") {
      const end = input.indexOf("'", index + 2);
      if (end === -1) {
        throw new Error(`Unterminated regex string at ${index}`);
      }
      tokens.push({ type: "regex", value: input.slice(index + 2, end), position: index });
      index = end + 1;
      continue;
    }

    if (char === "'") {
      const end = input.indexOf("'", index + 1);
      if (end === -1) {
        throw new Error(`Unterminated string at ${index}`);
      }
      tokens.push({ type: "string", value: input.slice(index + 1, end), position: index });
      index = end + 1;
      continue;
    }

    if (isDigit(char)) {
      const match = rest.match(/^\d+(B|KB|MB|GB|TB)?/);
      if (!match) {
        throw new Error(`Invalid number at ${index}`);
      }
      const unit = match[1];
      const value = unit ? String(Number.parseInt(match[0], 10) * byteUnits[unit]) : match[0];
      tokens.push({ type: "number", value, position: index });
      index += match[0].length;
      continue;
    }

    if (isIdentifierStart(char)) {
      let end = index + 1;
      while (end < input.length && isIdentifierPart(input[end])) {
        end += 1;
      }
      const value = input.slice(index, end);
      tokens.push({
        type: value === "and" || value === "or" ? "operator" : "identifier",
        value,
        position: index,
      });
      index = end;
      continue;
    }

    throw new Error(`Illegal character '${char}' at ${index}`);
  }

  tokens.push({ type: "eof", value: "", position: input.length });
  return tokens;
}

class Parser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly meta: FilterMetaData,
  ) {}

  parse() {
    const value = this.parseOr();
    this.expect("eof");
    return value;
  }

  private current() {
    return this.tokens[this.index];
  }

  private match(value: string) {
    if (this.current().value === value) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private expect(type: TokenType, value?: string) {
    const token = this.current();
    if (token.type !== type || (value && token.value !== value)) {
      throw new Error(`Unexpected token '${token.value}' at ${token.position}`);
    }
    this.index += 1;
    return token;
  }

  private parseOr(): FilterValue {
    let left = this.parseAnd();
    while (this.match("||") || this.match("or")) {
      const right = this.parseAnd();
      left = Boolean(left) || Boolean(right);
    }
    return left;
  }

  private parseAnd(): FilterValue {
    let left = this.parseEquality();
    while (this.match("&&") || this.match("and")) {
      const right = this.parseEquality();
      left = Boolean(left) && Boolean(right);
    }
    return left;
  }

  private parseEquality(): FilterValue {
    let left = this.parseComparison();
    for (;;) {
      if (this.match("==")) {
        left = this.compareValues(left, this.parseComparison(), "==");
      } else if (this.match("!=")) {
        left = this.compareValues(left, this.parseComparison(), "!=");
      } else {
        return left;
      }
    }
  }

  private parseComparison(): FilterValue {
    let left = this.parseTerm();
    for (;;) {
      if (this.match(">=")) {
        left = this.compareValues(left, this.parseTerm(), ">=");
      } else if (this.match("<=")) {
        left = this.compareValues(left, this.parseTerm(), "<=");
      } else if (this.match(">")) {
        left = this.compareValues(left, this.parseTerm(), ">");
      } else if (this.match("<")) {
        left = this.compareValues(left, this.parseTerm(), "<");
      } else {
        return left;
      }
    }
  }

  private parseTerm(): FilterValue {
    let left = this.parseFactor();
    for (;;) {
      if (this.match("+")) {
        left = this.numberValue(left) + this.numberValue(this.parseFactor());
      } else if (this.match("-")) {
        left = this.numberValue(left) - this.numberValue(this.parseFactor());
      } else {
        return left;
      }
    }
  }

  private parseFactor(): FilterValue {
    let left = this.parseUnary();
    for (;;) {
      if (this.match("*")) {
        left = this.numberValue(left) * this.numberValue(this.parseUnary());
      } else if (this.match("/")) {
        left = this.numberValue(left) / this.numberValue(this.parseUnary());
      } else {
        return left;
      }
    }
  }

  private parseUnary(): FilterValue {
    if (this.match("-")) {
      return -this.numberValue(this.parseUnary());
    }
    return this.parsePrimary();
  }

  private parsePrimary(): FilterValue {
    const token = this.current();
    if (this.match("(")) {
      const value = this.parseOr();
      this.expect("paren", ")");
      return value;
    }

    if (token.type === "number") {
      this.index += 1;
      return Number(token.value);
    }

    if (token.type === "date") {
      this.index += 1;
      return new Date(token.value.replace(" ", "T"));
    }

    if (token.type === "string") {
      this.index += 1;
      return token.value;
    }

    if (token.type === "regex") {
      this.index += 1;
      return new RegExp(token.value, "m");
    }

    if (token.type === "identifier") {
      this.index += 1;
      const key = aliases[token.value] ?? (token.value as keyof FilterMetaData);
      if (!(key in this.meta)) {
        throw new Error(`Undefined name ${token.value}`);
      }
      const value = this.meta[key];
      return key === "message_date" && typeof value === "string" ? new Date(value) : value;
    }

    throw new Error(`Unexpected token '${token.value}' at ${token.position}`);
  }

  private numberValue(value: FilterValue) {
    if (typeof value !== "number") {
      throw new Error(`${String(value)} is not number`);
    }
    return value;
  }

  private compareValues(left: FilterValue, right: FilterValue, operator: string) {
    if (left === undefined || right === undefined || left === null || right === null) {
      return false;
    }

    if (right instanceof RegExp) {
      const matched = typeof left === "string" && right.test(left);
      return operator === "!=" ? !matched : matched;
    }

    if (left instanceof RegExp) {
      const matched = typeof right === "string" && left.test(right);
      return operator === "!=" ? !matched : matched;
    }

    const normalizedLeft = left instanceof Date ? left.getTime() : left;
    const normalizedRight = right instanceof Date ? right.getTime() : right;

    switch (operator) {
      case "==":
        return normalizedLeft === normalizedRight;
      case "!=":
        return normalizedLeft !== normalizedRight;
      case ">":
        return normalizedLeft > normalizedRight;
      case "<":
        return normalizedLeft < normalizedRight;
      case ">=":
        return normalizedLeft >= normalizedRight;
      case "<=":
        return normalizedLeft <= normalizedRight;
      default:
        throw new Error(`Unsupported operator ${operator}`);
    }
  }
}

export class ExpressionFilterEngine implements FilterEngine {
  check(expression: string) {
    if (!expression.trim()) {
      return { ok: true };
    }

    try {
      const meta = {
        message_id: 1,
        message_date: "2024-01-01T00:00:00.000Z",
        message_caption: "",
        media_file_size: 1,
        media_file_name: "",
        media_type: "document",
        file_extension: "txt",
        sender_id: "",
        sender_name: "",
        reply_to_message_id: 1,
        message_thread_id: 1,
      } satisfies FilterMetaData;
      new Parser(tokenize(expression), meta).parse();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  execute(expression: string, meta: FilterMetaData) {
    if (!expression.trim()) {
      return true;
    }
    return Boolean(new Parser(tokenize(expression), meta).parse());
  }
}

export const filterEngine = new ExpressionFilterEngine();
