import { Directive, input } from "@angular/core";
import { BrnTabsTrigger } from "@spartan-ng/brain/tabs";
import { classes } from "@spartan-ng/helm/utils";

@Directive({
  selector: "[hlmTabsTrigger]",
  hostDirectives: [
    { directive: BrnTabsTrigger, inputs: ["brnTabsTrigger: hlmTabsTrigger", "disabled"] },
  ],
  host: {
    "data-slot": "tabs-trigger",
  },
})
export class HlmTabsTrigger {
  public readonly triggerFor = input.required<string>({ alias: "hlmTabsTrigger" });
  constructor() {
    classes(() => [
      `gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_ng-icon:not([class*='text-'])]:text-[length:--spacing(4)] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring text-foreground/60 hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground hover:scale-[1.02] active:scale-[0.98] relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center whitespace-nowrap transition-all duration-150 ease-out group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 [&_ng-icon]:pointer-events-none [&_ng-icon]:shrink-0 [&_ng-icon]:transition-transform [&_ng-icon]:duration-150 hover:[&_ng-icon]:scale-110`,
      "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
      "data-active:bg-background dark:data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input-fill/30 data-active:text-foreground",
      "after:bg-foreground after:absolute after:opacity-0 after:transition-opacity after:duration-200 group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
    ]);
  }
}
