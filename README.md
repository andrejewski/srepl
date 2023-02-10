# SREPL

> Save-Read-Eval-Print-Loop: The file is the REPL

REPLs are awesome. However, REPLs are still a mode of programming: you open up a separate terminal window, load up some of the code, and iterate on the side. The when things are sorted out in the REPL you pull them into the code.

SREPL is different. There's no extra window to manage. Each file is its own REPL: save the file, it is read and evaluated, and the values are printed alongside the code as code comments. Close the session and the comments are removed.

## Usage

SREPL is available on NPM:

```sh
npm install srepl
```

Add `p` ("print") calls to a module file:

```js
import { p } from 'srepl'

p(['Hello', 'world'].join(', '))
```

And run the `srepl` watcher daemon:

```sh
npm run srepl
```

Save the module file and SREPL will evaluate and print out the value passed to `p` as a code comment:

```js
import { p } from 'srepl'

p(['Hello', 'world'].join(', ')) //=> "Hello, world"
```

Keep iterating on your code and saving and new comments will be added automatically:

```js
import { p } from 'srepl'

const s = p(['Hello', 'world'].join(', ')) //=> "Hello, world"
p(s.toUpperCase()) //=> "HELLO, WORLD"
```

When you are done, terminate the `srepl` session and all code comments will be scrubbed from the file:

```js
import { p } from 'srepl'

const s = p(['Hello', 'world'].join(', '))
p(s.toUpperCase())
```

## Language support

SREPL supports JavaScript and TypeScript files.

Typescript support relies on certain `tsconfig.json` values:

- Only one `src` and only one `outDir` directory
- `sourceMap` set to true
- `noEmit` unset or set to false

## Debugging

Run `srepl` in debug mode to get a detailed look under the hood. If something isn't working as you expect, the logs may contain some useful information:

```sh
DEBUG=true npm run srepl
```
