//#region node_modules/.pnpm/@deepseek-ai+cosmokit@1.8.2/node_modules/@deepseek-ai/cosmokit/lib/index.js
/** Return true when a value is `null` or `undefined`. */
function isNullable(value) {
	return value === null || value === void 0;
}
/** Return true for non-array object values. */
function isPlainObject(data) {
	return data && typeof data === "object" && !Array.isArray(data);
}
/** Filter object entries and return a new object. */
function filterKeys(object, filter) {
	return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
/** Map object values while preserving the original key set. */
function mapValues(object, transform) {
	return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
/** Pick selected keys from an object, optionally including `undefined` values. */
function pick(source, keys, forced) {
	if (!keys) return { ...source };
	const result = {};
	for (const key of keys) if (forced || source[key] !== void 0) result[key] = source[key];
	return result;
}
/** Test values using `instanceof` with a `toStringTag` fallback. */
function is(type, value) {
	if (arguments.length === 1) return (value) => is(type, value);
	return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
	return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
	return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
/** Binary source detection and base64/hex conversion helpers. */
var Binary;
(function(Binary) {
	Binary.is = isArrayBufferLike;
	Binary.isSource = isArrayBufferSource;
	function fromSource(source) {
		if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
		else return source;
	}
	Binary.fromSource = fromSource;
	function toBase64(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
		let binary = "";
		const bytes = new Uint8Array(source);
		for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
		return btoa(binary);
	}
	Binary.toBase64 = toBase64;
	function fromBase64(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
		return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
	}
	Binary.fromBase64 = fromBase64;
	function toHex(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
		return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
	}
	Binary.toHex = toHex;
	function fromHex(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
		const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
		const buffer = [];
		for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
		return Uint8Array.from(buffer).buffer;
	}
	Binary.fromHex = fromHex;
})(Binary || (Binary = {}));
Binary.fromBase64;
Binary.toBase64;
Binary.fromHex;
Binary.toHex;
/** Deep-clone common JavaScript values while preserving prototypes and cycles. */
function clone(source, refs = /* @__PURE__ */ new Map()) {
	if (!source || typeof source !== "object") return source;
	if (is("Date", source)) return new Date(source.valueOf());
	if (is("RegExp", source)) return new RegExp(source.source, source.flags);
	if (isArrayBufferLike(source)) return source.slice(0);
	if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
	const cached = refs.get(source);
	if (cached) return cached;
	if (Array.isArray(source)) {
		const result = [];
		refs.set(source, result);
		source.forEach((value, index) => {
			result[index] = Reflect.apply(clone, null, [value, refs]);
		});
		return result;
	}
	const result = Object.create(Object.getPrototypeOf(source));
	refs.set(source, result);
	for (const key of Reflect.ownKeys(source)) {
		const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
		if ("value" in descriptor) descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
		Reflect.defineProperty(result, key, descriptor);
	}
	return result;
}
/** Deeply compare arrays, dates, regexps, buffers, and plain object fields. */
function deepEqual(a, b, strict) {
	if (a === b) return true;
	if (!strict && isNullable(a) && isNullable(b)) return true;
	if (typeof a !== typeof b) return false;
	if (typeof a !== "object") return false;
	if (!a || !b) return false;
	function check(test, then) {
		return test(a) ? test(b) ? then(a, b) : false : test(b) ? false : void 0;
	}
	return check(Array.isArray, (a, b) => a.length === b.length && a.every((item, index) => deepEqual(item, b[index]))) ?? check(is("Date"), (a, b) => a.valueOf() === b.valueOf()) ?? check(is("RegExp"), (a, b) => a.source === b.source && a.flags === b.flags) ?? check(isArrayBufferLike, (a, b) => {
		if (a.byteLength !== b.byteLength) return false;
		const viewA = new Uint8Array(a);
		const viewB = new Uint8Array(b);
		for (let i = 0; i < viewA.length; i++) if (viewA[i] !== viewB[i]) return false;
		return true;
	}) ?? Object.keys({
		...a,
		...b
	}).every((key) => deepEqual(a[key], b[key], strict));
}
/** Time constants plus parsing and formatting helpers. */
var Time;
(function(Time) {
	Time.millisecond = 1;
	Time.second = 1e3;
	Time.minute = Time.second * 60;
	Time.hour = Time.minute * 60;
	Time.day = Time.hour * 24;
	Time.week = Time.day * 7;
	let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
	function setTimezoneOffset(offset) {
		timezoneOffset = offset;
	}
	Time.setTimezoneOffset = setTimezoneOffset;
	function getTimezoneOffset() {
		return timezoneOffset;
	}
	Time.getTimezoneOffset = getTimezoneOffset;
	function getDateNumber(date = /* @__PURE__ */ new Date(), offset) {
		if (typeof date === "number") date = new Date(date);
		if (offset === void 0) offset = timezoneOffset;
		return Math.floor((date.valueOf() / Time.minute - offset) / 1440);
	}
	Time.getDateNumber = getDateNumber;
	function fromDateNumber(value, offset) {
		const date = new Date(value * Time.day);
		if (offset === void 0) offset = timezoneOffset;
		return new Date(+date + offset * Time.minute);
	}
	Time.fromDateNumber = fromDateNumber;
	const numeric = /\d+(?:\.\d+)?/.source;
	const timeRegExp = new RegExp(`^${[
		"w(?:eek(?:s)?)?",
		"d(?:ay(?:s)?)?",
		"h(?:our(?:s)?)?",
		"m(?:in(?:ute)?(?:s)?)?",
		"s(?:ec(?:ond)?(?:s)?)?"
	].map((unit) => `(${numeric}${unit})?`).join("")}$`);
	function parseTime(source) {
		const capture = timeRegExp.exec(source);
		if (!capture) return 0;
		return (parseFloat(capture[1]) * Time.week || 0) + (parseFloat(capture[2]) * Time.day || 0) + (parseFloat(capture[3]) * Time.hour || 0) + (parseFloat(capture[4]) * Time.minute || 0) + (parseFloat(capture[5]) * Time.second || 0);
	}
	Time.parseTime = parseTime;
	function parseDate(date) {
		const parsed = parseTime(date);
		if (parsed) date = Date.now() + parsed;
		else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date}`;
		else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date}`;
		return date ? new Date(date) : /* @__PURE__ */ new Date();
	}
	Time.parseDate = parseDate;
	function format(ms) {
		const abs = Math.abs(ms);
		if (abs >= Time.day - Time.hour / 2) return Math.round(ms / Time.day) + "d";
		else if (abs >= Time.hour - Time.minute / 2) return Math.round(ms / Time.hour) + "h";
		else if (abs >= Time.minute - Time.second / 2) return Math.round(ms / Time.minute) + "m";
		else if (abs >= Time.second) return Math.round(ms / Time.second) + "s";
		return ms + "ms";
	}
	Time.format = format;
	function toDigits(source, length = 2) {
		return source.toString().padStart(length, "0");
	}
	Time.toDigits = toDigits;
	function template(template, time = /* @__PURE__ */ new Date()) {
		return template.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
	}
	Time.template = template;
})(Time || (Time = {}));
//#endregion
//#region node_modules/.pnpm/@deepseek-ai+schemastery@3.18.1/node_modules/@deepseek-ai/schemastery/lib/index.mjs
const kSchema = Symbol.for("schemastery");
const kValidationError = Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = void 0;
var ValidationError = class extends TypeError {
	options;
	name = "ValidationError";
	constructor(message, options) {
		let prefix = "$";
		for (const segment of options.path || []) if (typeof segment === "string") prefix += "." + segment;
		else if (typeof segment === "number") prefix += "[" + segment + "]";
		else if (typeof segment === "symbol") prefix += `[Symbol(${segment.toString()})]`;
		if (prefix.startsWith(".")) prefix = prefix.slice(1);
		super((prefix === "$" ? "" : `${prefix} `) + message);
		this.options = options;
	}
	static is(error) {
		return !!error?.[kValidationError];
	}
};
Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
const Schema = function(options) {
	const schema = function(data, options = {}) {
		return Schema.resolve(data, schema, options)[0];
	};
	if (options.refs) {
		const refs = mapValues(options.refs, (options) => new Schema(options));
		const getRef = (uid) => refs[uid];
		for (const key in refs) {
			const options = refs[key];
			options.sKey = getRef(options.sKey);
			options.inner = getRef(options.inner);
			options.list = options.list && options.list.map(getRef);
			options.dict = options.dict && mapValues(options.dict, getRef);
		}
		return refs[options.uid];
	}
	Object.assign(schema, options);
	if (typeof schema.callback === "string") try {
		schema.callback = new Function("return " + schema.callback)();
	} catch {}
	Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
	Object.setPrototypeOf(schema, Schema.prototype);
	schema.meta ||= {};
	schema.toString = schema.toString.bind(schema);
	return schema;
};
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", { get() {
	return {
		version: 1,
		vendor: "schemastery",
		validate: (value) => {
			try {
				return { value: Schema.resolve(value, this, {})[0] };
			} catch (error) {
				if (ValidationError.is(error)) return { issues: [{
					message: error.message,
					path: error.options.path
				}] };
				throw error;
			}
		}
	};
} });
Schema.ValidationError = ValidationError;
Schema.prototype.toJSON = function toJSON() {
	if (globalThis.__schemastery_refs__) {
		globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
		return this.uid;
	}
	globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
	globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
	const result = {
		uid: this.uid,
		refs: globalThis.__schemastery_refs__
	};
	globalThis.__schemastery_refs__ = void 0;
	return result;
};
Schema.prototype.set = function set(key, value) {
	this.dict[key] = value;
	return this;
};
Schema.prototype.push = function push(value) {
	this.list.push(value);
	return this;
};
function mergeDesc(original, messages) {
	const result = typeof original === "string" ? { "": original } : { ...original };
	for (const locale in messages) {
		const value = messages[locale];
		if (value?.$description || value?.$desc) result[locale] = value.$description || value.$desc;
		else if (typeof value === "string") result[locale] = value;
	}
	return result;
}
function getInner(value) {
	return value?.$value ?? value?.$inner;
}
function extractKeys(data) {
	return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
}
Schema.prototype.i18n = function i18n(messages) {
	const schema = Schema(this);
	const desc = mergeDesc(schema.meta.description, messages);
	if (Object.keys(desc).length) schema.meta.description = desc;
	if (schema.dict) schema.dict = mapValues(schema.dict, (inner, key) => {
		return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
	});
	if (schema.list) schema.list = schema.list.map((inner, index) => {
		return inner.i18n(mapValues(messages, (data = {}) => {
			if (Array.isArray(getInner(data))) return getInner(data)[index];
			if (Array.isArray(data)) return data[index];
			return extractKeys(data);
		}));
	});
	if (schema.inner) schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
		if (getInner(data)) return getInner(data);
		return extractKeys(data);
	}));
	if (schema.sKey) schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
	return schema;
};
Schema.prototype.extra = function extra(key, value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
};
for (const key of [
	"required",
	"disabled",
	"collapse",
	"hidden",
	"loose"
]) Object.assign(Schema.prototype, { [key](value = true) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
Schema.prototype.deprecated = function deprecated() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "deprecated",
		type: "danger"
	});
	return schema;
};
Schema.prototype.experimental = function experimental() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "experimental",
		type: "warning"
	});
	return schema;
};
Schema.prototype.pattern = function pattern(regexp) {
	const schema = Schema(this);
	const pattern = pick(regexp, ["source", "flags"]);
	schema.meta = {
		...schema.meta,
		pattern
	};
	return schema;
};
Schema.prototype.simplify = function simplify(value) {
	if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
	if (isNullable(value)) return value;
	if (this.type === "object" || this.type === "dict") {
		const result = {};
		for (const key in value) {
			const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
			if (this.type === "dict" || !isNullable(item)) result[key] = item;
		}
		if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
		return result;
	} else if (this.type === "array" || this.type === "tuple") {
		const result = [];
		value.forEach((value, index) => {
			const schema = this.type === "array" ? this.inner : this.list[index];
			const item = schema ? schema.simplify(value) : value;
			result.push(item);
		});
		return result;
	} else if (this.type === "intersect") {
		const result = {};
		for (const item of this.list) Object.assign(result, item.simplify(value));
		return result;
	} else if (this.type === "union") for (const schema of this.list) try {
		Schema.resolve(value, schema, {});
		return schema.simplify(value);
	} catch {}
	return value;
};
Schema.prototype.toString = function toString(inline) {
	return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
};
Schema.prototype.role = function role(role, extra) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		role,
		extra
	};
	return schema;
};
for (const key of [
	"default",
	"link",
	"comment",
	"description",
	"max",
	"min",
	"step"
]) Object.assign(Schema.prototype, { [key](value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
const resolvers = {};
Schema.extend = function extend(type, resolve) {
	resolvers[type] = resolve;
};
Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
	if (!schema) return [data];
	if (options.ignore?.(data, schema)) return [data];
	if (isNullable(data) && schema.type !== "lazy") {
		if (schema.meta.required) throw new ValidationError(`missing required value`, options);
		let current = schema;
		let fallback = schema.meta.default;
		while (current?.type === "intersect" && isNullable(fallback)) {
			current = current.list[0];
			fallback = current?.meta.default;
		}
		if (isNullable(fallback)) return [data];
		data = clone(fallback);
	}
	const callback = resolvers[schema.type];
	if (!callback) throw new ValidationError(`unsupported type "${schema.type}"`, options);
	try {
		return callback(data, schema, options, strict);
	} catch (error) {
		if (!schema.meta.loose) throw error;
		return [schema.meta.default];
	}
};
Schema.from = function from(source) {
	if (isNullable(source)) return Schema.any();
	else if ([
		"string",
		"number",
		"boolean"
	].includes(typeof source)) return Schema.const(source).required();
	else if (source[kSchema]) return source;
	else if (typeof source === "function") switch (source) {
		case String: return Schema.string().required();
		case Number: return Schema.number().required();
		case Boolean: return Schema.boolean().required();
		case Function: return Schema.function().required();
		default: return Schema.is(source).required();
	}
	else throw new TypeError(`cannot infer schema from ${source}`);
};
Schema.lazy = function lazy(builder) {
	const toJSON = () => {
		if (!schema.inner[kSchema]) {
			schema.inner = schema.builder();
			schema.inner.meta = {
				...schema.meta,
				...schema.inner.meta
			};
		}
		return schema.inner.toJSON();
	};
	const schema = new Schema({
		type: "lazy",
		builder,
		inner: { toJSON }
	});
	return schema;
};
Schema.natural = function natural() {
	return Schema.number().step(1).min(0);
};
Schema.percent = function percent() {
	return Schema.number().step(.01).min(0).max(1).role("slider");
};
Schema.date = function date() {
	return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
		const date = new Date(value);
		if (isNaN(+date)) throw new ValidationError(`invalid date "${value}"`, options);
		return date;
	}, true)]);
};
Schema.regExp = function regExp(flag = "") {
	return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
		try {
			return new RegExp(value, flag);
		} catch (e) {
			throw new ValidationError(e.message, options);
		}
	}, true)]);
};
Schema.arrayBuffer = function arrayBuffer(encoding) {
	return Schema.union([
		Schema.is(ArrayBuffer),
		Schema.is(SharedArrayBuffer),
		Schema.transform(Schema.any(), (value, options) => {
			if (Binary.isSource(value)) return Binary.fromSource(value);
			throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
		}, true),
		...encoding ? [Schema.transform(Schema.string(), (value, options) => {
			try {
				return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
			} catch (e) {
				throw new ValidationError(e.message, options);
			}
		}, true)] : []
	]);
};
Schema.extend("lazy", (data, schema, options, strict) => {
	if (!schema.inner[kSchema]) {
		schema.inner = schema.builder();
		schema.inner.meta = {
			...schema.meta,
			...schema.inner.meta
		};
	}
	return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
	return [data];
});
Schema.extend("never", (data, _, options) => {
	throw new ValidationError(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
	if (deepEqual(data, value)) return [value];
	throw new ValidationError(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
	const { max = Infinity, min = -Infinity } = meta;
	if (data > max) throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
	if (data < min && !skipMin) throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
}
Schema.extend("string", (data, { meta }, options) => {
	if (typeof data !== "string") throw new ValidationError(`expected string but got ${data}`, options);
	if (meta.pattern) {
		const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
		if (!regexp.test(data)) throw new ValidationError(`expect string to match regexp ${regexp}`, options);
	}
	checkWithinRange(data.length, meta, "string length", options);
	return [data];
});
function decimalShift(data, digits) {
	const str = data.toString();
	if (str.includes("e")) return data * Math.pow(10, digits);
	const index = str.indexOf(".");
	if (index === -1) return data * Math.pow(10, digits);
	const frac = str.slice(index + 1);
	const integer = str.slice(0, index);
	if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
	return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
function isMultipleOf(data, min, step) {
	step = Math.abs(step);
	if (!/^\d+\.\d+$/.test(step.toString())) return (data - min) % step === 0;
	const index = step.toString().indexOf(".");
	const digits = step.toString().slice(index + 1).length;
	return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
Schema.extend("number", (data, { meta }, options) => {
	if (typeof data !== "number") throw new ValidationError(`expected number but got ${data}`, options);
	checkWithinRange(data, meta, "number", options);
	const { step } = meta;
	if (step && !isMultipleOf(data, meta.min ?? 0, step)) throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
	return [data];
});
Schema.extend("boolean", (data, _, options) => {
	if (typeof data === "boolean") return [data];
	throw new ValidationError(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
	let value = 0, keys = [];
	if (typeof data === "number") {
		value = data;
		for (const key in bits) if (data & bits[key]) keys.push(key);
	} else if (Array.isArray(data)) {
		keys = data;
		for (const key of keys) {
			if (typeof key !== "string") throw new ValidationError(`expected string but got ${key}`, options);
			if (key in bits) value |= bits[key];
		}
	} else throw new ValidationError(`expected number or array but got ${data}`, options);
	if (value === meta.default) return [value];
	return [value, keys];
});
Schema.extend("function", (data, _, options) => {
	if (typeof data === "function") return [data];
	throw new ValidationError(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
	if (typeof constructor === "function") {
		if (data instanceof constructor) return [data];
		throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
	} else {
		if (isNullable(data)) throw new ValidationError(`expected ${constructor} but got ${data}`, options);
		let prototype = Object.getPrototypeOf(data);
		while (prototype) {
			if (prototype.constructor?.name === constructor) return [data];
			prototype = Object.getPrototypeOf(prototype);
		}
		throw new ValidationError(`expected ${constructor} but got ${data}`, options);
	}
});
function property(data, key, schema, options) {
	try {
		const [value, adapted] = Schema.resolve(data[key], schema, {
			...options,
			path: [...options.path || [], key]
		});
		if (adapted !== void 0) data[key] = adapted;
		return value;
	} catch (e) {
		if (!options?.autofix) throw e;
		delete data[key];
		return schema.meta.default;
	}
}
Schema.extend("array", (data, { inner, meta }, options) => {
	if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
	checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
	return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
	if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
	const result = {};
	for (const key in data) {
		let rKey;
		try {
			rKey = Schema.resolve(key, sKey, options)[0];
		} catch (error) {
			if (strict) continue;
			throw error;
		}
		result[rKey] = property(data, key, inner, options);
		data[rKey] = data[key];
		if (key !== rKey) delete data[key];
	}
	return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
	if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
	const result = list.map((inner, index) => property(data, index, inner, options));
	if (strict) return [result];
	result.push(...data.slice(list.length));
	return [result];
});
function merge(result, data) {
	for (const key in data) {
		if (key in result) continue;
		result[key] = data[key];
	}
}
Schema.extend("object", (data, { dict }, options, strict) => {
	if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
	const result = {};
	for (const key in dict) {
		const value = property(data, key, dict[key], options);
		if (!isNullable(value) || key in data) result[key] = value;
	}
	if (!strict) merge(result, data);
	return [result];
});
Schema.extend("union", (data, { list, toString }, options, strict) => {
	const messages = [];
	for (const inner of list) try {
		return Schema.resolve(data, inner, options, strict);
	} catch (error) {
		messages.push(error);
	}
	throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString }, options, strict) => {
	if (!list.length) return [data];
	let result;
	for (const inner of list) {
		const value = Schema.resolve(data, inner, options, true)[0];
		if (isNullable(value)) continue;
		if (isNullable(result)) result = value;
		else if (typeof result !== typeof value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
		else if (typeof value === "object") merge(result ??= {}, value);
		else if (result !== value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
	}
	if (!strict && isPlainObject(data)) merge(result, data);
	return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
	const [result, adapted = data] = Schema.resolve(data, inner, options, true);
	if (preserve) return [callback(result)];
	else return [callback(result), callback(adapted)];
});
const formatters = {};
function defineMethod(name, keys, format) {
	formatters[name] = format;
	Object.assign(Schema, { [name](...args) {
		const schema = new Schema({ type: name });
		keys.forEach((key, index) => {
			switch (key) {
				case "sKey":
					schema.sKey = args[index] ?? Schema.string();
					break;
				case "inner":
					schema.inner = Schema.from(args[index]);
					break;
				case "list":
					schema.list = args[index].map(Schema.from);
					break;
				case "dict":
					schema.dict = mapValues(args[index], Schema.from);
					break;
				case "bits":
					schema.bits = {};
					for (const key in args[index]) {
						if (typeof args[index][key] !== "number") continue;
						schema.bits[key] = args[index][key];
					}
					break;
				case "callback": {
					const callback = schema.callback = args[index];
					callback["toJSON"] ||= () => callback.toString();
					break;
				}
				case "constructor": {
					const constructor = schema.constructor = args[index];
					if (typeof constructor === "function") constructor["toJSON"] ||= () => constructor["name"];
					break;
				}
				default: schema[key] = args[index];
			}
		});
		if (name === "object" || name === "dict") schema.meta.default = {};
		else if (name === "array" || name === "tuple") schema.meta.default = [];
		else if (name === "bitset") schema.meta.default = 0;
		return schema;
	} });
}
defineMethod("is", ["constructor"], ({ constructor }) => {
	if (typeof constructor === "function") return constructor.name;
	else return constructor;
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
	if (Object.keys(dict).length === 0) return "{}";
	return `{ ${Object.entries(dict).map(([key, inner]) => {
		return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
	}).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
	const result = list.map(({ toString: format }) => format()).join(" | ");
	return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
	return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", [
	"inner",
	"callback",
	"preserve"
], ({ inner }, isInner) => inner.toString(isInner));
//#endregion
//#region src/service/secid.ts
/** Convert `sh600519` / `sz000001` / `bj830799` (or a bare 6-digit code) to Eastmoney secid. */
function codeToSecid(code) {
	const raw = code.trim().toLowerCase();
	if (raw.startsWith("sh")) return `1.${raw.slice(2)}`;
	if (raw.startsWith("sz") || raw.startsWith("bj")) return `0.${raw.slice(2)}`;
	if (/^[69]/.test(raw)) return `1.${raw}`;
	return `0.${raw}`;
}
/** Reconstruct a prefixed A-share code from Eastmoney market id + 6-digit code. */
function prefixedCode(market, digits) {
	const num = String(digits).padStart(6, "0");
	if (Number(market) === 1) return `sh${num}`;
	if (num.startsWith("8") || num.startsWith("4")) return `bj${num}`;
	return `sz${num}`;
}
//#endregion
//#region src/service/providers/eastmoney.ts
const UA$1 = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const REFERER = "https://quote.eastmoney.com/";
/** Fields used by `qt/ulist.np/get` with `fltt=2` (prices already in yuan). */
const ULIST_FIELDS = [
	"f12",
	"f13",
	"f14",
	"f2",
	"f3",
	"f4",
	"f15",
	"f16",
	"f17",
	"f18",
	"f5",
	"f6",
	"f8",
	"f9",
	"f23",
	"f20",
	"f124"
].join(",");
async function fetchEastmoney(codes) {
	if (codes.length === 0) return [];
	const secids = codes.map(codeToSecid).join(",");
	const url = new URL("https://push2.eastmoney.com/api/qt/ulist.np/get");
	url.searchParams.set("fltt", "2");
	url.searchParams.set("np", "1");
	url.searchParams.set("fields", ULIST_FIELDS);
	url.searchParams.set("secids", secids);
	const resp = await fetch(url, { headers: {
		"User-Agent": UA$1,
		Referer: REFERER
	} });
	if (!resp.ok) return [];
	const rows = (await resp.json()).data?.diff ?? [];
	const quotes = [];
	for (const row of rows) {
		const digits = String(row.f12 ?? "");
		if (!digits) continue;
		const price = num$2(row.f2);
		quotes.push({
			code: prefixedCode(row.f13, digits),
			name: String(row.f14 ?? ""),
			price,
			pct: num$2(row.f3),
			change: num$2(row.f4),
			high: num$2(row.f15),
			low: num$2(row.f16),
			open: num$2(row.f17),
			prevClose: num$2(row.f18),
			volume: num$2(row.f5),
			turnover: num$2(row.f6),
			turnoverRate: num$2(row.f8),
			pe: num$2(row.f9),
			pb: num$2(row.f23),
			marketCap: num$2(row.f20),
			ts: num$2(row.f124) ? num$2(row.f124) * 1e3 : Date.now()
		});
	}
	return quotes;
}
const KLT = {
	day: 101,
	week: 102,
	month: 103,
	"5": 5,
	"15": 15,
	"30": 30,
	"60": 60
};
const FQT = {
	qfq: 1,
	hfq: 2,
	none: 0
};
/** Daily/weekly/monthly & minute OHLCV history from Eastmoney (shared by tool + HTTP route). */
async function fetchKlineEastmoney(code, opts = {}) {
	const period = KLT[opts.period ?? "day"] !== void 0 ? opts.period ?? "day" : "day";
	const adjust = FQT[opts.adjust ?? "qfq"] !== void 0 ? opts.adjust ?? "qfq" : "qfq";
	const count = Math.min(Math.max(Math.trunc(opts.count ?? 60), 1), 500);
	const url = new URL("https://push2his.eastmoney.com/api/qt/stock/kline/get");
	url.searchParams.set("secid", codeToSecid(code));
	url.searchParams.set("fields1", "f1,f2,f3,f4,f5");
	url.searchParams.set("fields2", "f51,f52,f53,f54,f55,f56,f57,f58");
	url.searchParams.set("klt", String(KLT[period]));
	url.searchParams.set("fqt", String(FQT[adjust]));
	url.searchParams.set("end", "20500101");
	url.searchParams.set("lmt", String(count));
	const resp = await fetch(url, { headers: {
		"User-Agent": UA$1,
		Referer: REFERER
	} });
	if (!resp.ok) throw new Error(`kline upstream HTTP ${resp.status}`);
	return {
		code,
		period,
		bars: ((await resp.json()).data?.klines ?? []).map((line) => {
			const [ts, open, close, high, low, volume, turnover] = line.split(",");
			return {
				ts,
				open: Number(open),
				close: Number(close),
				high: Number(high),
				low: Number(low),
				volume: Number(volume),
				turnover: turnover ? Number(turnover) : void 0
			};
		})
	};
}
async function searchEastmoney(query, limit = 10) {
	const url = new URL("https://searchapi.eastmoney.com/api/suggest/get");
	url.searchParams.set("input", query);
	url.searchParams.set("type", "14");
	url.searchParams.set("count", String(limit));
	url.searchParams.set("token", "D43BF722C8E33BDC906FB84D85E326E8");
	const resp = await fetch(url, { headers: { "User-Agent": UA$1 } });
	if (!resp.ok) throw new Error(`quote_search upstream HTTP ${resp.status}`);
	return ((await resp.json()).QuotationCodeTable?.Data ?? []).map((item) => {
		const digits = String(item.Code ?? "");
		const mkt = String(item.MktNum ?? "");
		return {
			code: prefixedCode(mkt, digits),
			name: String(item.Name ?? ""),
			type: mkt
		};
	}).filter((hit) => /^\w{2}\d{6}$/.test(hit.code));
}
function num$2(value) {
	const n = typeof value === "string" ? Number(value) : Number(value);
	return Number.isFinite(n) ? n : 0;
}
//#endregion
//#region src/service/providers/tencent.ts
/**
* 腾讯行情源（默认）。
* - 快照: https://qt.gtimg.cn/q=sh600519,sz300750   (GBK 文本, ~ 分隔 88 字段)
* - 日K:  https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,day,,,30,qfq
* - 分时: https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=sh600519
* 全部无需鉴权, 无 Referer 白名单（2026-08 实测）。
*/
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
/** qt.gtimg.cn `~`-separated field indexes (verified against Eastmoney values). */
const F = {
	market: 0,
	name: 1,
	price: 3,
	prevClose: 4,
	open: 5,
	volume: 6,
	datetime: 30,
	change: 31,
	pct: 32,
	high: 33,
	low: 34,
	turnover: 37,
	turnoverRate: 38,
	floatCap: 44,
	marketCap: 45,
	pb: 46,
	pe: 52
};
async function fetchTencent(codes) {
	if (codes.length === 0) return [];
	const url = `https://qt.gtimg.cn/q=${codes.join(",")}`;
	const resp = await fetch(url, { headers: { "User-Agent": UA } });
	if (!resp.ok) throw new Error(`tencent snapshot HTTP ${resp.status}`);
	const text = new TextDecoder("gbk").decode(new Uint8Array(await resp.arrayBuffer()));
	const quotes = [];
	for (const line of text.split("\n")) {
		const m = line.match(/v_(\w+)="([^"]*)"/);
		if (!m) continue;
		const f = m[2].split("~");
		if (f.length < 60) continue;
		const price = num$1(f[F.price]);
		if (price <= 0) continue;
		quotes.push({
			code: m[1],
			name: f[F.name],
			price,
			prevClose: num$1(f[F.prevClose]),
			open: num$1(f[F.open]),
			high: num$1(f[F.high]),
			low: num$1(f[F.low]),
			change: num$1(f[F.change]),
			pct: num$1(f[F.pct]),
			volume: num$1(f[F.volume]),
			turnover: num$1(f[F.turnover]) * 1e4,
			turnoverRate: num$1(f[F.turnoverRate]),
			pe: num$1(f[F.pe]),
			pb: num$1(f[F.pb]),
			marketCap: num$1(f[F.marketCap]) * 1e8,
			ts: parseQtTime(f[F.datetime])
		});
	}
	return quotes;
}
/** Daily/weekly/monthly bars via fqkline (复权). Minute periods are not handled here. */
async function fetchTencentKline(code, opts = {}) {
	const period = [
		"day",
		"week",
		"month"
	].includes(opts.period ?? "day") ? opts.period ?? "day" : "day";
	const adjust = opts.adjust === "hfq" ? "hfq" : "qfq";
	const count = Math.min(Math.max(Math.trunc(opts.count ?? 60), 1), 500);
	const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${encodeURIComponent(`${code},${period},,,${count},${adjust}`)}`;
	const resp = await fetch(url, { headers: { "User-Agent": UA } });
	if (!resp.ok) throw new Error(`tencent kline HTTP ${resp.status}`);
	const json = await resp.json();
	if (json.code !== 0 || !json.data?.[code]) throw new Error("tencent kline empty payload");
	const payload = json.data[code];
	const rows = payload[`${adjust}${period}`] ?? payload[period];
	if (!Array.isArray(rows)) throw new Error("tencent kline missing rows");
	return {
		code,
		period,
		bars: rows.map((row) => {
			const r = row;
			return {
				ts: r[0],
				open: Number(r[1]),
				close: Number(r[2]),
				high: Number(r[3]),
				low: Number(r[4]),
				volume: Number(r[5])
			};
		})
	};
}
/** 当日分时: one point per trading minute (≈240 rows for a full session). */
async function fetchTencentIntraday(code) {
	const url = `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${encodeURIComponent(code)}`;
	const resp = await fetch(url, { headers: { "User-Agent": UA } });
	if (!resp.ok) throw new Error(`tencent intraday HTTP ${resp.status}`);
	const json = await resp.json();
	const payload = json.data?.[code]?.data;
	if (json.code !== 0 || !payload?.data) throw new Error("tencent intraday empty payload");
	const minutes = payload.data.map((row) => {
		const [t, p] = row.split(" ");
		return {
			t,
			p: Number(p)
		};
	}).filter((m) => m.t && Number.isFinite(m.p) && m.p > 0);
	return {
		code,
		date: payload.date ?? "",
		minutes
	};
}
function num$1(value) {
	const n = Number(value);
	return Number.isFinite(n) ? n : 0;
}
/** `20260819161441` → epoch ms. */
function parseQtTime(raw) {
	if (!raw || !/^\d{14}$/.test(raw)) return Date.now();
	const s = raw;
	return new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)), Number(s.slice(8, 10)), Number(s.slice(10, 12)), Number(s.slice(12, 14))).getTime();
}
//#endregion
//#region src/service/providers/sina.ts
/**
* 新浪 hq.sinajs.cn 备份数据源。
* 返回格式: var hq_str_sh600000="贵州茅台,1680.50,1690.00,...";
* 字段顺序(逗号分隔,30 个):
*   0 名字 1 今开 2 昨收 3 当前价 4 今日最高 5 今日最低
*   6 买一价 7 卖一价 8 成交量(股) 9 成交额
*   ... 30 时间
*/
async function fetchSina(codes) {
	if (codes.length === 0) return [];
	const url = `https://hq.sinajs.cn/list=${codes.join(",")}`;
	const resp = await fetch(url, { headers: {
		"Referer": "https://finance.sina.com.cn/",
		"User-Agent": "Mozilla/5.0"
	} });
	if (!resp.ok) return [];
	const body = await resp.text();
	const quotes = [];
	const lines = body.split(/\n/);
	let idx = 0;
	for (const line of lines) {
		const m = line.match(/var hq_str_(\w+)="([^"]*)"/);
		if (!m) continue;
		const code = m[1];
		const fields = m[2].split(",");
		if (fields.length < 32 || idx >= codes.length) {
			idx++;
			continue;
		}
		const price = num(fields[3]);
		if (price === 0) {
			idx++;
			continue;
		}
		const prevClose = num(fields[2]);
		quotes.push({
			code,
			name: fields[0],
			price,
			open: num(fields[1]),
			prevClose,
			high: num(fields[4]),
			low: num(fields[5]),
			change: price - prevClose,
			pct: prevClose === 0 ? 0 : (price - prevClose) / prevClose * 100,
			volume: num(fields[8]),
			turnover: num(fields[9]),
			turnoverRate: 0,
			pe: 0,
			pb: 0,
			marketCap: 0,
			ts: parseSinaTime(fields[30], fields[31])
		});
		idx++;
	}
	return quotes;
}
function num(v) {
	const n = Number(v);
	return Number.isFinite(n) ? n : 0;
}
function parseSinaTime(date, time) {
	if (!date || !time) return Date.now();
	const t = (/* @__PURE__ */ new Date(`${date}T${time}+08:00`)).getTime();
	return Number.isFinite(t) ? t : Date.now();
}
//#endregion
//#region src/service/providers/premium-adapter.ts
function fetchPremium(provider, token) {
	switch (provider) {
		case "longbridge": return (codes) => fetchLongbridge(codes, token);
		case "futu": return (codes) => fetchFutu(codes, token);
		case "tonglian": return (codes) => fetchTonglian(codes, token);
		default: return () => Promise.resolve([]);
	}
}
async function fetchLongbridge(_codes, _token) {
	throw new Error("longbridge provider is not implemented; falling back is handled by the service");
}
async function fetchFutu(_codes, _token) {
	throw new Error("futu provider is not implemented");
}
async function fetchTonglian(_codes, _token) {
	throw new Error("tonglian provider is not implemented");
}
//#endregion
//#region src/service/derived.ts
const MA_PERIODS = [
	20,
	60,
	120
];
/** Metrics computable from the snapshot alone (no kline fetch). */
function snapshotMetrics(quote, indexPct) {
	const amplitude = quote.prevClose > 0 ? round((quote.high - quote.low) / quote.prevClose * 100) : 0;
	const range = quote.high - quote.low;
	return {
		amplitude,
		dayRangePos: range > 0 ? round(Math.min(Math.max((quote.price - quote.low) / range, 0), 1)) : .5,
		relativePct: round(quote.pct - indexPct)
	};
}
/** Metrics that need daily kline closes (most recent last). */
function historyMetrics(closes) {
	const price = closes[closes.length - 1] ?? 0;
	const window = closes.slice(-250);
	const high = Math.max(...window);
	const low = Math.min(...window);
	const maDev = {};
	for (const period of MA_PERIODS) {
		const ma = sma(closes, period);
		maDev[String(period)] = ma === null ? NaN : round((price - ma) / ma * 100);
	}
	return {
		pctFrom52wHigh: high > 0 ? round((price - high) / high * 100) : 0,
		pctFrom52wLow: low > 0 ? round((price - low) / low * 100) : 0,
		maDev
	};
}
/** Simple moving average over the last `period` closes; null when insufficient data. */
function sma(closes, period) {
	if (closes.length < period) return null;
	let sum = 0;
	for (let i = closes.length - period; i < closes.length; i += 1) sum += closes[i];
	return sum / period;
}
function round(value) {
	return Math.round(value * 100) / 100;
}
//#endregion
//#region src/service/quote-cn-service.ts
function createQuoteCnService(config) {
	const cache = /* @__PURE__ */ new Map();
	const klineCache = /* @__PURE__ */ new Map();
	const intradayCache = /* @__PURE__ */ new Map();
	const subs = /* @__PURE__ */ new Set();
	const provider = pickProviderChain(config);
	const get = (codes) => codes.map((code) => cache.get(normalize(code))?.quote).filter((q) => q !== void 0);
	const put = (quotes) => {
		const now = Date.now();
		for (const quote of quotes) cache.set(normalize(quote.code), {
			quote,
			at: now
		});
	};
	const fetchFresh = async (codes) => {
		const unique = [...new Set(codes.map(normalize).filter(Boolean))];
		if (unique.length === 0) return [];
		const now = Date.now();
		const stale = [];
		const fresh = [];
		for (const code of unique) {
			const hit = cache.get(code);
			if (hit && now - hit.at < config.cacheTtlMs) fresh.push(hit.quote);
			else stale.push(code);
		}
		if (stale.length === 0) return orderBy(fresh, unique);
		const fetched = await provider(stale.slice(0, config.maxConcurrentFetches * 4));
		put(fetched);
		return orderBy([...fresh, ...fetched], unique);
	};
	return {
		get,
		fetch: fetchFresh,
		async search(query, market) {
			let hits = await searchEastmoney(query);
			if (market) {
				const prefix = market.toLowerCase();
				hits = hits.filter((hit) => hit.code.startsWith(prefix));
			}
			return hits;
		},
		kline(code, opts = {}) {
			const key = `${normalize(code)}|${opts.period ?? "day"}|${opts.count ?? 60}|${opts.adjust ?? "qfq"}`;
			const hit = klineCache.get(key);
			if (hit && Date.now() - hit.at < 6e5) return Promise.resolve(hit.result);
			const canTencent = [
				"day",
				"week",
				"month"
			].includes(opts.period ?? "day") && (opts.adjust ?? "qfq") !== "none";
			const run = async () => {
				if (canTencent) try {
					return await fetchTencentKline(code, opts);
				} catch {}
				return fetchKlineEastmoney(code, opts);
			};
			return run().then((result) => {
				klineCache.set(key, {
					result,
					at: Date.now()
				});
				return result;
			});
		},
		intraday(code) {
			const key = normalize(code);
			const hit = intradayCache.get(key);
			if (hit && Date.now() - hit.at < 6e4) return Promise.resolve(hit.result);
			return fetchTencentIntraday(code).then((result) => {
				intradayCache.set(key, {
					result,
					at: Date.now()
				});
				return result;
			});
		},
		async fetchDerived(codes) {
			const quotes = await fetchFresh(codes);
			if (quotes.length === 0) return quotes;
			let indexPct = 0;
			try {
				const index = (await fetchFresh(["sh000001"]))[0];
				if (index) indexPct = index.pct;
			} catch {}
			await Promise.allSettled(quotes.map(async (quote) => {
				const base = snapshotMetrics(quote, indexPct);
				let hist;
				try {
					const closes = (await this.kline(quote.code, {
						period: "day",
						count: 250,
						adjust: "qfq"
					})).bars.map((bar) => bar.close).filter((close) => Number.isFinite(close) && close > 0);
					if (closes.length > 0 && quote.price > 0) closes[closes.length - 1] = quote.price;
					if (closes.length > 0) hist = historyMetrics(closes);
				} catch {}
				quote.derived = hist ? {
					amplitude: base.amplitude,
					dayRangePos: base.dayRangePos,
					relativePct: base.relativePct,
					pctFrom52wHigh: hist.pctFrom52wHigh,
					pctFrom52wLow: hist.pctFrom52wLow,
					maDev: hist.maDev
				} : {
					amplitude: base.amplitude,
					dayRangePos: base.dayRangePos,
					relativePct: base.relativePct
				};
			}));
			return quotes;
		},
		subscribe(codes) {
			for (const code of codes.map(normalize).filter(Boolean)) subs.add(code);
		},
		unsubscribe(codes) {
			for (const code of codes.map(normalize)) subs.delete(code);
		},
		listWatchlist() {
			return [...subs];
		},
		async poll() {
			if (!isAShareSession(/* @__PURE__ */ new Date()) || subs.size === 0) return [];
			return fetchFresh([...subs]);
		}
	};
}
/**
* Ordered fallback chain of snapshot providers. The configured provider leads;
* the remaining free sources back it up. First non-empty result wins, so one
* dead upstream never blanks the panel.
*/
function pickProviderChain(config) {
	const free = {
		tencent: fetchTencent,
		eastmoney: fetchEastmoney,
		sina: fetchSina
	};
	const lead = pickLeadProvider(config);
	const chain = [];
	if (lead === "premium") {
		const premium = fetchPremium(config.premium.provider, process.env[config.premium.tokenEnv] ?? "");
		chain.push(premium);
	} else if (free[lead]) chain.push(free[lead]);
	for (const key of [
		"tencent",
		"eastmoney",
		"sina"
	]) if (!chain.includes(free[key])) chain.push(free[key]);
	return async (codes) => {
		let lastError;
		for (const fetcher of chain) try {
			const quotes = await fetcher(codes);
			if (quotes.length > 0) return quotes;
		} catch (error) {
			lastError = error;
		}
		if (lastError) throw lastError instanceof Error ? lastError : new Error(String(lastError));
		return [];
	};
}
function pickLeadProvider(config) {
	switch (config.defaultProvider) {
		case "eastmoney": return "eastmoney";
		case "sina": return "sina";
		case "premium": {
			const name = config.premium.provider;
			if (!(config.premium.tokenEnv ? process.env[config.premium.tokenEnv] ?? "" : "") || name !== "longbridge" && name !== "futu" && name !== "tonglian") return "tencent";
			return "premium";
		}
		default: return "tencent";
	}
}
function normalize(code) {
	return code.trim().toLowerCase();
}
function orderBy(quotes, codes) {
	const map = new Map(quotes.map((q) => [normalize(q.code), q]));
	return codes.map((code) => map.get(code)).filter((q) => q !== void 0);
}
function isAShareSession(now) {
	const utc = now.getTime() + now.getTimezoneOffset() * 6e4;
	const beijing = new Date(utc + 288e5);
	const day = beijing.getDay();
	if (day === 0 || day === 6) return false;
	const minutes = beijing.getHours() * 60 + beijing.getMinutes();
	return minutes >= 570 && minutes < 690 || minutes >= 780 && minutes < 900;
}
//#endregion
//#region src/api/http.ts
function sendJson(response, status, payload) {
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-type": "application/json; charset=utf-8"
	});
	response.end(JSON.stringify(payload));
}
function requestUrl(request) {
	return new URL(request.url ?? "/", "http://127.0.0.1");
}
//#endregion
//#region src/api/routes.ts
function mountQuoteRoutes(webServer, service) {
	const disposers = [
		webServer.register({
			kind: "exact",
			path: "/quote-cn/health",
			handler: (_req, res) => {
				sendJson(res, 200, {
					ok: true,
					plugin: "@zhuyeqi/dsh-plugin-quote-cn"
				});
			}
		}),
		webServer.register({
			kind: "exact",
			path: "/quote-cn/snapshot",
			handler: async (req, res) => {
				if (req.method !== "GET") {
					res.writeHead(405, { allow: "GET" });
					res.end();
					return;
				}
				const codes = (requestUrl(req).searchParams.get("codes") ?? "").split(",").map((c) => c.trim()).filter(Boolean);
				try {
					sendJson(res, 200, requestUrl(req).searchParams.get("derived") === "1" ? await service.fetchDerived(codes) : await service.fetch(codes));
				} catch (error) {
					sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) });
				}
			}
		}),
		webServer.register({
			kind: "exact",
			path: "/quote-cn/search",
			handler: async (req, res) => {
				if (req.method !== "GET") {
					res.writeHead(405, { allow: "GET" });
					res.end();
					return;
				}
				const query = requestUrl(req).searchParams.get("q")?.trim() ?? "";
				if (!query) {
					sendJson(res, 400, { error: "missing q" });
					return;
				}
				try {
					sendJson(res, 200, await service.search(query, requestUrl(req).searchParams.get("market") ?? void 0));
				} catch (error) {
					sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) });
				}
			}
		}),
		webServer.register({
			kind: "exact",
			path: "/quote-cn/kline",
			handler: async (req, res) => {
				if (req.method !== "GET") {
					res.writeHead(405, { allow: "GET" });
					res.end();
					return;
				}
				const params = requestUrl(req).searchParams;
				const code = params.get("code")?.trim().toLowerCase() ?? "";
				if (!/^(sh|sz|bj)\d{6}$/.test(code)) {
					sendJson(res, 400, { error: "invalid code, expected e.g. sh600519" });
					return;
				}
				const period = params.get("period") ?? "day";
				if (![
					"day",
					"week",
					"month",
					"5",
					"15",
					"30",
					"60"
				].includes(period)) {
					sendJson(res, 400, { error: "invalid period" });
					return;
				}
				const adjust = params.get("adjust") ?? "qfq";
				if (![
					"qfq",
					"hfq",
					"none"
				].includes(adjust)) {
					sendJson(res, 400, { error: "invalid adjust" });
					return;
				}
				const countRaw = Number(params.get("count") ?? 30);
				const count = Number.isFinite(countRaw) ? Math.min(Math.max(Math.trunc(countRaw), 1), 500) : 30;
				try {
					sendJson(res, 200, await service.kline(code, {
						period,
						count,
						adjust
					}));
				} catch (error) {
					sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) });
				}
			}
		}),
		webServer.register({
			kind: "exact",
			path: "/quote-cn/intraday",
			handler: async (req, res) => {
				if (req.method !== "GET") {
					res.writeHead(405, { allow: "GET" });
					res.end();
					return;
				}
				const code = requestUrl(req).searchParams.get("code")?.trim().toLowerCase() ?? "";
				if (!/^(sh|sz|bj)\d{6}$/.test(code)) {
					sendJson(res, 400, { error: "invalid code, expected e.g. sh600519" });
					return;
				}
				try {
					const intraday = await service.intraday(code);
					const quote = service.get([code])[0];
					sendJson(res, 200, {
						code: intraday.code,
						date: intraday.date,
						minutes: intraday.minutes,
						prevClose: quote?.prevClose ?? 0
					});
				} catch (error) {
					sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) });
				}
			}
		})
	];
	return () => {
		for (const dispose of disposers) dispose();
	};
}
//#endregion
//#region src/tools/quote-get.ts
/**
* Real-time snapshot tool. The output schema is the enforced raw JSON Schema
* subset: `required` is an object-level array, `additionalProperties` is a
* boolean on every object, and only annotation keywords describe fields.
*/
const OUTPUT_SCHEMA = {
	type: "array",
	items: {
		type: "object",
		additionalProperties: false,
		properties: {
			code: {
				type: "string",
				description: "带交易所前缀的代码, e.g. sh600519"
			},
			name: {
				type: "string",
				description: "股票名称"
			},
			price: {
				type: "number",
				description: "现价"
			},
			change: {
				type: "number",
				description: "涨跌额"
			},
			pct: {
				type: "number",
				description: "涨跌幅 %"
			},
			open: {
				type: "number",
				description: "今开"
			},
			high: {
				type: "number",
				description: "最高"
			},
			low: {
				type: "number",
				description: "最低"
			},
			prevClose: {
				type: "number",
				description: "昨收"
			},
			volume: {
				type: "number",
				description: "成交量(手)"
			},
			turnover: {
				type: "number",
				description: "成交额(元)"
			},
			turnoverRate: {
				type: "number",
				description: "换手率 %"
			},
			pe: {
				type: "number",
				description: "市盈率"
			},
			pb: {
				type: "number",
				description: "市净率"
			},
			marketCap: {
				type: "number",
				description: "总市值(元)"
			},
			derived: {
				type: "object",
				additionalProperties: false,
				properties: {
					amplitude: {
						type: "number",
						description: "振幅 (high-low)/prevClose, %"
					},
					dayRangePos: {
						type: "number",
						description: "日内位置 (price-low)/(high-low), 0..1"
					},
					relativePct: {
						type: "number",
						description: "相对上证指数超额涨跌, %"
					},
					pctFrom52wHigh: {
						type: "number",
						description: "距52周高点, % (<=0)"
					},
					pctFrom52wLow: {
						type: "number",
						description: "距52周低点, % (>=0)"
					},
					maDev: {
						type: "object",
						additionalProperties: false,
						description: "距N日均线偏离度 (price-MA_N)/MA_N, %; keys: 20/60/120",
						properties: {
							"20": { type: "number" },
							"60": { type: "number" },
							"120": { type: "number" }
						}
					}
				}
			},
			ts: {
				type: "number",
				description: "数据时间戳 (ms)"
			}
		},
		required: [
			"code",
			"name",
			"price",
			"change",
			"pct",
			"ts"
		]
	}
};
function registerQuoteGetTool(ctx, service) {
	ctx.systemPrompt.section({
		name: "tool:quote_get",
		order: 200,
		text: `Use quote_get to fetch real-time A-share quotes (price, change, pe, etc).
Stock codes are 6 digits with exchange prefix: 'sh600000', 'sz000001', 'bj830799'.
Always call this BEFORE making investment-related claims.`
	});
	const definition = {
		name: "quote_get",
		description: "Get real-time A-share quote snapshot for one or more stocks. Returns price, change, pct, OHLC, volume, turnover, pe, pb, marketCap, plus derived analytics (derived.amplitude 振幅%, derived.dayRangePos 日内位置0-1, derived.relativePct 相对上证超额%, derived.pctFrom52wHigh/pctFrom52wLow 距52周高低点%, derived.maDev 距MA20/60/120均线偏离%).",
		parameters: {
			type: "object",
			properties: { codes: {
				type: "array",
				items: { type: "string" },
				description: "Stock codes with exchange prefix, e.g. [\"sh600000\",\"sz000001\"]. sh=沪市, sz=深市, bj=北交所."
			} },
			required: ["codes"]
		},
		output: {
			schema: OUTPUT_SCHEMA,
			render: (_args, value) => [{
				type: "text",
				text: value.map((q) => {
					let line = `${q.code} ${q.name}: ¥${q.price.toFixed(2)} (${q.change >= 0 ? "+" : ""}${q.change.toFixed(2)} ${q.pct >= 0 ? "+" : ""}${q.pct.toFixed(2)}%)`;
					const d = q.derived;
					if (d) {
						const ma = [
							"20",
							"60",
							"120"
						].filter((n) => Number.isFinite(d.maDev?.[n])).map((n) => `MA${n} ${fmtSigned(d.maDev[n])}`);
						line += ` | 振幅 ${d.amplitude.toFixed(2)}% 日内位 ${(d.dayRangePos * 100).toFixed(0)}% 相对上证 ${fmtSigned(d.relativePct)}%`;
						if (Number.isFinite(d.pctFrom52wHigh)) line += ` 距52周高 ${fmtSigned(d.pctFrom52wHigh)}%/低 +${d.pctFrom52wLow.toFixed(2)}%`;
						if (ma.length > 0) line += ` | ${ma.join(" ")}`;
					}
					return line;
				}).join("\n")
			}],
			presentationMeta: (_args, value) => ({ quotes: value })
		},
		isConcurrencySafe: () => true,
		async execute(args) {
			const raw = argsRecord(args).codes;
			const codes = Array.isArray(raw) ? raw.filter((c) => typeof c === "string") : typeof raw === "string" ? [raw] : [];
			const quotes = await service.fetchDerived(codes);
			if (quotes.length === 0) throw new Error(`No data for codes [${codes.join(", ")}]. Codes may be invalid. Valid prefixes: sh (沪市), sz (深市), bj (北交所).`);
			return quotes;
		},
		presentCall: (args) => ({
			card: "generic",
			kind: "fetch",
			title: `行情 ${renderCodes(args)}`
		}),
		presentResult: (_args, result) => result.isError ? void 0 : {
			card: "generic",
			title: "行情快照"
		}
	};
	ctx.tools.register(definition);
}
function renderCodes(args) {
	const raw = argsRecord(args).codes;
	return (Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []).join(", ");
}
function fmtSigned(value) {
	return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}
//#endregion
//#region src/tools/quote-search.ts
function registerQuoteSearchTool(ctx, service) {
	ctx.systemPrompt.section({
		name: "tool:quote_search",
		order: 201,
		text: `Use quote_search to find an A-share stock by Chinese name or partial code.
Returns up to 10 matches; pair with quote_get for full quote.`
	});
	ctx.tools.register({
		name: "quote_search",
		description: "Search A-share stocks by Chinese name or 6-digit code. Returns up to 10 matches.",
		parameters: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "搜索关键词 (中文名或部分代码)"
				},
				market: {
					type: "string",
					description: "市场过滤: sh / sz / bj, 不传则全部"
				}
			},
			required: ["query"]
		},
		output: {
			schema: {
				type: "array",
				items: {
					type: "object",
					additionalProperties: false,
					properties: {
						code: { type: "string" },
						name: { type: "string" },
						type: { type: "string" }
					},
					required: ["code", "name"]
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: value.length === 0 ? "No matching stocks found." : value.map((v) => `${v.code} ${v.name}`).join("\n")
			}],
			presentationMeta: (_args, value) => ({ matches: value })
		},
		isConcurrencySafe: () => true,
		async execute(args) {
			const record = argsRecord(args);
			const query = typeof record.query === "string" ? record.query : "";
			const market = typeof record.market === "string" ? record.market : void 0;
			return service.search(query, market);
		},
		presentCall: (args) => ({
			card: "generic",
			kind: "search",
			title: `搜股 ${argsRecord(args).query ?? ""}`
		}),
		presentResult: (_args, result) => result.isError ? void 0 : {
			card: "generic",
			title: "股票搜索"
		}
	});
}
//#endregion
//#region src/tools/quote-kline.ts
const PERIODS = [
	"day",
	"week",
	"month",
	"5",
	"15",
	"30",
	"60"
];
const ADJUSTS = [
	"qfq",
	"hfq",
	"none"
];
function registerQuoteKlineTool(ctx, service) {
	ctx.systemPrompt.section({
		name: "tool:quote_kline",
		order: 202,
		text: `Use quote_kline to fetch OHLCV history for an A-share stock.
Supports daily/weekly/monthly and minute-level (5/15/30/60min).`
	});
	ctx.tools.register({
		name: "quote_kline",
		description: "Get OHLCV (open, high, low, close, volume) history for an A-share stock. Returns up to 500 bars.",
		parameters: {
			type: "object",
			properties: {
				code: {
					type: "string",
					description: "Stock code with prefix, e.g. \"sh600000\""
				},
				period: {
					type: "string",
					description: "day | week | month | 5 | 15 | 30 | 60 (分钟)"
				},
				count: {
					type: "number",
					description: "返回 K 线根数,最大 500"
				},
				adjust: {
					type: "string",
					description: "qfq (前复权) | hfq (后复权) | none (不复权)"
				}
			},
			required: ["code"]
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					code: { type: "string" },
					period: { type: "string" },
					bars: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								ts: { type: "string" },
								open: { type: "number" },
								high: { type: "number" },
								low: { type: "number" },
								close: { type: "number" },
								volume: { type: "number" },
								turnover: { type: "number" }
							},
							required: [
								"ts",
								"open",
								"high",
								"low",
								"close",
								"volume"
							]
						}
					}
				},
				required: [
					"code",
					"period",
					"bars"
				]
			},
			render: (_args, value) => [{
				type: "text",
				text: (() => {
					const { code, period, bars } = value;
					return `${code} ${period} ${bars.length} bars. Last close: ¥${bars[bars.length - 1]?.close.toFixed(2)}`;
				})()
			}],
			presentationMeta: (_args, value) => value
		},
		isConcurrencySafe: () => true,
		async execute(args) {
			const record = argsRecord(args);
			const code = typeof record.code === "string" ? record.code : "";
			const period = typeof record.period === "string" && PERIODS.includes(record.period) ? record.period : "day";
			const adjust = typeof record.adjust === "string" && ADJUSTS.includes(record.adjust) ? record.adjust : "qfq";
			const countRaw = Number(record.count);
			const count = Number.isFinite(countRaw) && countRaw > 0 ? Math.min(Math.trunc(countRaw), 500) : 60;
			return service.kline(code, {
				period,
				count,
				adjust
			});
		},
		presentCall: (args) => {
			const record = argsRecord(args);
			return {
				card: "generic",
				kind: "fetch",
				title: `K线 ${record.code ?? ""} ${typeof record.period === "string" ? record.period : "day"}`
			};
		},
		presentResult: (_args, result) => result.isError ? void 0 : {
			card: "generic",
			title: "K 线"
		}
	});
}
//#endregion
//#region src/tools/index.ts
/** Coerce the model-provided args object into a plain record. */
function argsRecord(args) {
	return args !== null && typeof args === "object" ? args : {};
}
function registerQuoteTools(ctx, service) {
	registerQuoteGetTool(ctx, service);
	registerQuoteSearchTool(ctx, service);
	registerQuoteKlineTool(ctx, service);
}
//#endregion
//#region src/index.ts
/**
* Host entry for the A-share quote plugin.
*
* One cordis row, named after this package so `dsh-client-modules` can
* discover `dsh.client` and serve `/plugins/@zhuyeqi/dsh-plugin-quote-cn/client.js`.
*/
const name = "quote-cn";
const inject = ["timer"];
const Config = Schema.object({
	pollIntervalMs: Schema.number().min(1e3).default(5e3),
	maxConcurrentFetches: Schema.number().min(1).max(16).default(4),
	cacheTtlMs: Schema.number().min(500).default(4e3),
	defaultProvider: Schema.string().default("tencent"),
	premium: Schema.object({
		provider: Schema.string().default("longbridge"),
		tokenEnv: Schema.string().default("LONGBRIDGE_TOKEN")
	}).default({
		provider: "longbridge",
		tokenEnv: "LONGBRIDGE_TOKEN"
	})
});
function apply(ctx, config) {
	const service = createQuoteCnService(config);
	ctx.effect(() => ctx.timer.interval(() => {
		service.poll();
	}, config.pollIntervalMs), "quote-cn: poll");
	ctx.inject(["webServer"], (host) => {
		host.effect(() => mountQuoteRoutes(host.webServer, service), "quote-cn: http routes");
	});
	ctx.inject(["tools", "systemPrompt"], (agent) => {
		registerQuoteTools(agent, service);
	});
}
//#endregion
export { Config, apply, inject, name };
