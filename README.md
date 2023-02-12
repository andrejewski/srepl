# SREPL

> Save-Read-Eval-Print-Loop: The file is the REPL

REPLs are awesome. However, REPLs are a mode of programming: you open up a separate terminal window, load up some of the code, and iterate on the side. When things are sorted out in the REPL you pull them into the code.

With SREPL there's no extra window to manage. Each file is its own REPL: save the file, it is read and evaluated, and the results are printed alongside the code as comments. Close the session and the comments are removed.

**[Watch a demo →](https://www.youtube.com/watch?v=EvuYXqb4kxE)**

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

Keep iterating on your code and saving. New comments will be added automatically:

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
