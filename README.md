# Clifry

#### CLI Functional Testing tool powered by Node.JS

## Design Philosophy

This tool allows a way to black-box test a command line app by writing simple javascript code.

Instead of having to learn how to configure a taskrunner tool like grunt or gulp, the idea is to write simple javascript code with a very simple API related to running CLIs.

It's up to you to use something like the standard unix dif tool or any node js module of your choosing to compare whatever your CLI creates, or if you're more interested in
what it spits out to stdio or stder, you can use simple javascript to compare
what you expected to what you saw.

Clifry was made to test black-box-test Airfy, a javascript static site generator.
