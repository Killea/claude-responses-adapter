import chalk from 'chalk';

// Claude Code Inspired Palette
const Palette = {
    Brand: '#D97757',      // Warm Terracotta (Main Brand)
    Error: '#D95858',      // Soft Red
    Warning: '#D9A458',    // Mustard Yellow
    Dim: '#6B6B6B',        // Dark Gray
    Text: '#E6E6E6',       // Off-White
    Border: '#3F3F3F',     // Subtle Border
    Highlight: '#A78BFA'   // Soft Purple (Files/Links)
};

export class UI {
    static log(message: string) {
        console.log(message);
    }

    static info(message: string) {
        this.log(`${chalk.hex(Palette.Dim).bold('•')} ${chalk.hex(Palette.Text)(message)}`);
    }

    static success(message: string) {
        this.log(`${chalk.hex(Palette.Brand)('✔')} ${chalk.hex(Palette.Brand)(message)}`);
    }

    static warning(message: string) {
        this.log(`${chalk.hex(Palette.Dim)('⚠')} ${message}`);
    }

    static error(message: string, error?: Error) {
        this.log(`${chalk.hex(Palette.Dim)('✖')} ${message}`);
        if (error && error.message) {
            this.log(chalk.hex(Palette.Error)(`  ${error.message}`));
        }
    }

    static header(subtitle: string) {
        this.log('');
        this.log(chalk.hex(Palette.Dim)(`  ${subtitle}`));
        this.log('');
    }

    static status(text: string) {
        this.log(`${chalk.hex(Palette.Dim)('•')} ${chalk.hex(Palette.Text)(text)}`);
    }

    static statusDone(success: boolean = true, text?: string) {
        if (success) {
            this.log(`${chalk.hex(Palette.Dim)('✔')} ${text || ''}`);
        } else {
            this.log(`${chalk.hex(Palette.Dim)('✖')} ${text || ''}`);
        }
    }

    static box(title: string, content: string[]) {
        const border = chalk.hex(Palette.Border)('──────────────────────────────────────────────────');
        this.log('');
        this.log(border);
        this.log(chalk.hex(Palette.Brand).bold(`  ${title}`));
        this.log(border);
        content.forEach(line => this.log(`  ${line}`));
        this.log(border);
        this.log('');
    }

    static newUrl(url: string): string {
        return chalk.hex(Palette.Highlight).bold.underline(url);
    }

    static dim(text: string): string {
        return chalk.hex(Palette.Dim)(text);
    }

    static highlight(text: string): string {
        return chalk.hex(Palette.Highlight)(text);
    }

    static hint(text: string) {
        this.log(`  ${chalk.hex(Palette.Dim)(text)}`);
    }

    static flagState(enabled: boolean): string {
        return enabled
            ? chalk.hex(Palette.Warning).bold('ON')
            : chalk.hex(Palette.Dim).bold('OFF');
    }

    static experimentFlags(flags: { disableTools?: boolean; disableHistory?: boolean }) {
        this.log(`  ${chalk.hex(Palette.Dim)('Experimental flags:')} disableTools=${this.flagState(Boolean(flags.disableTools))}  disableHistory=${this.flagState(Boolean(flags.disableHistory))}`);
    }

    static banner() {
        const brand = chalk.hex(Palette.Brand);
        const dim = chalk.hex(Palette.Dim);

        const art = [
            '',
            dim('     ┌──────────────────────────┐'),
            dim('     │ ') + brand('CLAUDE RESPONSES') + dim('     ├──┐'),
            dim('     │ ') + brand('ADAPTER') + dim('               │▓▓│'),
            dim('     │ ') + dim('Claude → Responses bridge') + dim(' ├──┘'),
            dim('     └──────────────────────────┘'),
            '',
        ];

        art.forEach(line => this.log(line));
    }

    static table(rows: { label: string; value: string }[]) {
        const maxLabelWidth = Math.max(...rows.map(r => r.label.length));
        this.log('');
        rows.forEach(row => {
            const paddedLabel = row.label.padEnd(maxLabelWidth);
            this.log(`  ${chalk.hex(Palette.Dim)(paddedLabel)}  ${chalk.hex(Palette.Highlight)(row.value)}`);
        });
        this.log('');
    }

    static updateNotify(current: string, latest: string) {
        this.log('');
        this.log(`${chalk.hex(Palette.Dim)('•')} ${chalk.hex(Palette.Text)('Update available:')} ${chalk.hex(Palette.Dim)(current)} ${chalk.hex(Palette.Dim)('→')} ${chalk.hex(Palette.Highlight)(latest)}`);
        this.hint('Run "npm i -g claude-responses-adapter" to update');
    }
}
